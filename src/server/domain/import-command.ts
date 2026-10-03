import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { acquiredSnapshotSchema, type AcquiredSnapshot } from "@/server/ingestion/adapters";
import { companyImportSource } from "./import-scope";

export interface StageImportInput {
  snapshot: AcquiredSnapshot;
  idempotencyKey: string;
  dryRun: boolean;
}

function sameRequest(run: {
  snapshotSha256: string | null;
  adapterKey: string | null;
  adapterVersion: number | null;
  inputFormat: string | null;
  dryRun: boolean;
}, snapshot: AcquiredSnapshot, dryRun: boolean): boolean {
  return run.snapshotSha256 === snapshot.sha256
    && run.adapterKey === snapshot.adapterKey
    && run.adapterVersion === snapshot.adapterVersion
    && run.inputFormat === snapshot.format
    && run.dryRun === dryRun;
}

export async function stageImportCommand(actor: SessionUser, input: StageImportInput, ip: string | null) {
  const snapshot = acquiredSnapshotSchema.parse(input.snapshot);
  const scope = companyImportSource(actor);
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new HttpError(400, "A valid import idempotency key is required.", "IMPORT_IDEMPOTENCY_KEY_INVALID");
  }

  const existing = await db.importRun.findUnique({ where: { idempotencyKey }, include: { importSource: { select: { name: true } } } });
  if (existing) {
    if (existing.triggeredBy !== actor.email || existing.importSource.name !== scope.name) throw new HttpError(409, "This request key belongs to another administrator or company.", "IMPORT_IDEMPOTENCY_CONFLICT");
    if (!sameRequest(existing, snapshot, input.dryRun)) {
      throw new HttpError(409, "This import request key was already used for different snapshot data.", "IMPORT_IDEMPOTENCY_CONFLICT");
    }
    return { importRunId: existing.id, status: existing.status, duplicateRequest: true };
  }

  try {
    return await db.$transaction(async (tx) => {
      const source = await tx.importSource.upsert({
        where: { name: scope.name },
        create: { name: scope.name, ownerOrganizationId: scope.ownerOrganizationId, sourceType: snapshot.format, notes: "Company Admin-submitted source snapshot" },
        update: {},
      });
      if (source.ownerOrganizationId !== scope.ownerOrganizationId) throw new HttpError(409, "The import source ownership changed.", "IMPORT_SCOPE_CONFLICT");
      const run = await tx.importRun.create({
        data: {
          importSourceId: source.id,
          status: "QUEUED",
          inputFormat: snapshot.format,
          importMode: "SNAPSHOT",
          idempotencyKey,
          dryRun: input.dryRun,
          adapterKey: snapshot.adapterKey,
          adapterVersion: snapshot.adapterVersion,
          sourceVersion: snapshot.sourceVersion,
          snapshotRetrievedAt: snapshot.retrievedAt,
          snapshotSha256: snapshot.sha256,
          snapshotRef: snapshot.storageRef,
          chunkSize: 250,
          triggeredBy: actor.email,
        },
      });
      const event = await emitEvent("import_run", run.id, "import.staged.requested", {
        importRunId: run.id,
        requestedBy: actor.id,
      }, tx);
      await audit({
        actorId: actor.id,
        organizationId: actor.organizationId,
        action: "import.stage",
        resourceType: "import_run",
        resourceId: run.id,
        before: null,
        after: {
          status: "QUEUED",
          format: snapshot.format,
          sha256: snapshot.sha256,
          adapterKey: snapshot.adapterKey,
          adapterVersion: snapshot.adapterVersion,
          dryRun: input.dryRun,
          outboxEventId: event.id,
        },
        ip,
      }, tx);
      return { importRunId: run.id, status: run.status, duplicateRequest: false, outboxEventId: event.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      const raced = await db.importRun.findUnique({ where: { idempotencyKey }, include: { importSource: { select: { name: true } } } });
      if (raced && raced.triggeredBy === actor.email && raced.importSource.name === scope.name && sameRequest(raced, snapshot, input.dryRun)) {
        return { importRunId: raced.id, status: raced.status, duplicateRequest: true };
      }
      if (raced) throw new HttpError(409, "This import request key was already used for different snapshot data.", "IMPORT_IDEMPOTENCY_CONFLICT");
      throw new HttpError(409, "Another import is being queued. Retry with the same idempotency key.", "IMPORT_STAGE_CONFLICT");
    }
    throw error;
  }
}

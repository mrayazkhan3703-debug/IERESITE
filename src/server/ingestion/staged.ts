import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getConfiguredIngestionAdapter,
  acquiredSnapshotSchema,
  JsonParseError,
  UnsupportedIngestionAdapterError,
} from "./adapters";
import { CsvParseError } from "./csv";
import { openVerifiedImportSnapshot, SnapshotIntegrityError } from "./snapshot";
import { runImport } from "./pipeline";

const CHUNK_LEASE_MS = 10 * 60_000;

class ImportChunkBusyError extends Error {
  constructor() {
    super("An import chunk is already being processed by another worker.");
    this.name = "ImportChunkBusyError";
  }
}

class ImportCheckpointError extends Error {
  constructor() {
    super("The import checkpoint does not match the next source record.");
    this.name = "ImportCheckpointError";
  }
}

function terminalInputError(error: unknown): boolean {
  return error instanceof CsvParseError
    || error instanceof JsonParseError
    || error instanceof SnapshotIntegrityError
    || error instanceof UnsupportedIngestionAdapterError
    || error instanceof ImportCheckpointError;
}

async function failRun(runId: string, reason: string) {
  await db.importRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: reason.slice(0, 500), finishedAt: new Date() },
  });
}

async function processChunk(input: {
  runId: string;
  sourceId: string;
  firstRecordNumber: number;
  records: Record<string, unknown>[];
  triggeredBy: string | null;
  dryRun: boolean;
}): Promise<void> {
  const { runId, sourceId, firstRecordNumber, records } = input;
  const lastRecordNumber = firstRecordNumber + records.length - 1;
  const digest = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  const leaseToken = randomUUID();
  const now = new Date();

  await db.$transaction(async (tx) => {
      const run = await tx.importRun.findUniqueOrThrow({ where: { id: runId } });
      const computedChunkNumber = Math.floor((firstRecordNumber - 1) / run.chunkSize) + 1;
      const existing = await tx.importRunChunk.findUnique({
        where: { importRunId_chunkNumber: { importRunId: runId, chunkNumber: computedChunkNumber } },
      });
      if (existing?.status === "SUCCEEDED") {
        if (existing.checksum !== digest || run.recordCursor < lastRecordNumber) throw new ImportCheckpointError();
        return;
      }

      let chunkId: string;
      if (!existing) {
        const created = await tx.importRunChunk.create({
          data: {
            importRunId: runId,
            chunkNumber: computedChunkNumber,
            firstRecordNumber,
            lastRecordNumber,
            recordsCount: records.length,
            status: "RUNNING",
            checksum: digest,
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + CHUNK_LEASE_MS),
          },
        });
        chunkId = created.id;
      } else {
        if (existing.checksum !== digest || existing.firstRecordNumber !== firstRecordNumber || existing.lastRecordNumber !== lastRecordNumber) {
          throw new ImportCheckpointError();
        }
        if (existing.status === "RUNNING" && existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
          throw new ImportChunkBusyError();
        }
        const claim = await tx.importRunChunk.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            ...(existing.status === "RUNNING" ? { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] } : {}),
          },
          data: {
            status: "RUNNING",
            attempts: { increment: 1 },
            startedAt: now,
            completedAt: null,
            error: null,
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + CHUNK_LEASE_MS),
          },
        });
        if (claim.count !== 1) throw new ImportChunkBusyError();
        chunkId = existing.id;
      }

      if (run.recordCursor !== firstRecordNumber - 1) throw new ImportCheckpointError();
      await runImport({
        sourceId,
        records,
        triggeredBy: input.triggeredBy ?? undefined,
        dryRun: input.dryRun,
        runId,
        recordNumbers: records.map((_, index) => firstRecordNumber + index),
        importRunChunkId: chunkId,
        finalize: false,
        client: tx,
      });
      const completed = await tx.importRunChunk.updateMany({
        where: { id: chunkId, status: "RUNNING", leaseToken },
        data: { status: "SUCCEEDED", recordsCount: records.length, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
      });
      if (completed.count !== 1) throw new ImportChunkBusyError();
      const advanced = await tx.importRun.updateMany({
        where: { id: runId, status: "RUNNING", recordCursor: firstRecordNumber - 1 },
        data: { recordCursor: lastRecordNumber },
      });
      if (advanced.count !== 1) throw new ImportCheckpointError();
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });
}

async function finishRun(runId: string) {
  const [run, actions] = await Promise.all([
    db.importRun.findUniqueOrThrow({ where: { id: runId } }),
    db.importRecord.groupBy({ by: ["action"], where: { importRunId: runId }, _count: { _all: true } }),
  ]);
  const count = (action: string) => actions.find((entry) => entry.action === action)?._count._all ?? 0;
  const recordsTotal = actions.reduce((total, entry) => total + entry._count._all, 0);
  const recordsCreated = count("CREATED");
  const recordsUpdated = count("UPDATED");
  const skippedDuplicate = count("SKIPPED_DUPLICATE");
  const skippedInvalid = count("SKIPPED_INVALID");
  const recordsFailed = count("FAILED");
  if (recordsTotal === 0) {
    await failRun(runId, "No records were found in the staged snapshot.");
    return;
  }
  const status = run.dryRun ? "DRY_RUN" : recordsFailed > 0 ? "PARTIAL" : "SUCCEEDED";
  await db.importRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      error: recordsTotal === 0 ? "No records were found in the staged snapshot." : null,
      recordsTotal,
      recordsCreated,
      recordsUpdated,
      recordsSkipped: skippedDuplicate + skippedInvalid,
      recordsFailed,
      duplicatesDetected: skippedDuplicate,
    },
  });
}

/** Process a verified staged snapshot and checkpoint each bounded record chunk. */
export async function processStagedImport(runId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!runId || runId.length > 128) throw new Error("importRunId is required");
  const run = await db.importRun.findUnique({ where: { id: runId }, include: { importSource: true } });
  if (!run) throw new Error("Staged import run not found");
  if (["SUCCEEDED", "PARTIAL", "DRY_RUN"].includes(run.status)) return;
  if (run.importMode !== "SNAPSHOT") {
    await failRun(runId, "This import mode is not enabled; no records were changed.");
    return;
  }
  if (!run.snapshotRef || !run.snapshotSha256 || !run.adapterKey || !run.adapterVersion || !run.snapshotRetrievedAt || !run.inputFormat) {
    await failRun(runId, "The staged import is missing required snapshot or adapter provenance.");
    return;
  }

  const snapshot = acquiredSnapshotSchema.parse({
    sourceKey: run.importSource.name,
    format: run.inputFormat,
    sourceVersion: run.sourceVersion,
    retrievedAt: run.snapshotRetrievedAt,
    sha256: run.snapshotSha256,
    storageRef: run.snapshotRef,
    adapterKey: run.adapterKey,
    adapterVersion: run.adapterVersion,
    mappingJson: run.mappingJson,
  });
  const adapter = getConfiguredIngestionAdapter(snapshot.adapterKey, snapshot.adapterVersion, snapshot.mappingJson);
  if (adapter.format !== snapshot.format) {
    await failRun(runId, "The staged input format does not match its recorded adapter.");
    return;
  }
  const chunkSize = Math.min(500, Math.max(1, run.chunkSize));

  await db.importRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), finishedAt: null, error: null },
  });

  try {
    let sourceRecordCount = 0;
    const validationChunks = await openVerifiedImportSnapshot(snapshot);
    for await (const raw of adapter.parse(validationChunks)) {
      signal?.throwIfAborted();
      sourceRecordCount += 1;
      adapter.validate(adapter.normalize(raw));
    }
    if (sourceRecordCount === 0) {
      await failRun(runId, "No records were found in the staged snapshot.");
      return;
    }
    if (run.recordCursor > sourceRecordCount) throw new ImportCheckpointError();

    let recordNumber = 0;
    let firstRecordNumber = run.recordCursor + 1;
    let records: Record<string, unknown>[] = [];
    const importChunks = await openVerifiedImportSnapshot(snapshot);
    for await (const raw of adapter.parse(importChunks)) {
      signal?.throwIfAborted();
      recordNumber += 1;
      if (recordNumber <= run.recordCursor) continue;
      records.push(adapter.normalize(raw));
      if (records.length === chunkSize) {
        await processChunk({
          runId,
          sourceId: run.importSourceId,
          firstRecordNumber,
          records,
          triggeredBy: run.triggeredBy,
          dryRun: run.dryRun,
        });
        firstRecordNumber = recordNumber + 1;
        records = [];
      }
    }
    if (recordNumber !== sourceRecordCount) throw new SnapshotIntegrityError();
    signal?.throwIfAborted();
    if (records.length > 0) {
      await processChunk({
        runId,
        sourceId: run.importSourceId,
        firstRecordNumber,
        records,
        triggeredBy: run.triggeredBy,
        dryRun: run.dryRun,
      });
    }
    await finishRun(runId);
  } catch (error) {
    if (terminalInputError(error)) {
      await failRun(runId, error instanceof Error ? error.message : "Staged import input failed validation.");
      return;
    }
    throw error;
  }
}

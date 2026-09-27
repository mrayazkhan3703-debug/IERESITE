import { Prisma } from "@prisma/client";
import { db, parseJson } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { enqueueJob } from "@/server/jobs/outbox";

/** Idempotent, audited replay of one DLQ item. Queue and replay marker commit together. */
export async function replayDeadLetterCommand(actor: SessionUser, deadLetterId: string, ip: string | null, scheduledAt = new Date()) {
  return db.$transaction(async (tx) => {
    const item = await tx.deadLetterEvent.findUnique({ where: { id: deadLetterId } });
    if (!item) throw new HttpError(404, "Dead letter not found.", "DLQ_NOT_FOUND");
    if (item.replayedAt) throw new HttpError(409, "This dead letter has already been replayed.", "DLQ_ALREADY_REPLAYED");

    const payload = parseJson<Record<string, unknown>>(item.payloadJson, {});
    await enqueueJob(item.jobKey, payload, `replay:${item.id}`, scheduledAt, tx);
    const replayedAt = new Date();
    const changed = await tx.deadLetterEvent.updateMany({
      where: { id: item.id, replayedAt: null },
      data: { replayedAt },
    });
    if (changed.count !== 1) throw new HttpError(409, "This dead letter changed during replay.", "DLQ_REPLAY_CONFLICT");

    await audit({
      actorId: actor.id, organizationId: actor.organizationId, action: "job.dlq.replay",
      resourceType: "dead_letter", resourceId: item.id,
      before: { jobKey: item.jobKey, sourceId: item.sourceId, attempts: item.attempts, replayedAt: null },
      after: { jobKey: item.jobKey, sourceId: item.sourceId, attempts: item.attempts, replayedAt },
      ip,
    }, tx);
    return { ok: true as const, replayedAt: replayedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This dead letter changed during replay. Refresh and retry.", "DLQ_REPLAY_CONFLICT");
    }
    throw error;
  });
}

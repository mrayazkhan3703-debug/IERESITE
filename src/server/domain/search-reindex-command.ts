import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";

/** Queue a full search rebuild; completion is owned by the worker, not the request. */
export async function requestSearchReindexCommand(actor: SessionUser, ip: string | null) {
  return db.$transaction(async (tx) => {
    const event = await emitEvent("system", "search-index", "search.reindex.requested", {
      requestedBy: actor.id,
    }, tx);
    await audit({
      actorId: actor.id,
      organizationId: actor.organizationId,
      action: "search.reindex.request",
      resourceType: "search_index",
      resourceId: "search-index",
      before: null,
      after: { status: "QUEUED", outboxEventId: event.id },
      ip,
    }, tx);
    return { status: "QUEUED" as const, outboxEventId: event.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

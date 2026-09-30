import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { publicListingWhere } from "@/server/domain/visibility";
import { rebuildIndex } from "@/server/search/service";

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

/** Explicit, bounded maintenance path while a worker is unavailable. */
export async function directSearchReindexCommand(actor: SessionUser, ip: string | null) {
  if (!actor.roles.some((r) => ["OWNER", "ADMIN"].includes(r))) throw new HttpError(403, "Owner or Admin access is required.");
  const eligible = await db.listing.count({ where: publicListingWhere() });
  if (eligible > 1000) throw new HttpError(409, "Direct rebuilds are limited to 1,000 public listings. Use the worker queue for larger inventories.", "SEARCH_DIRECT_LIMIT");
  const operationId = crypto.randomUUID();
  await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "search.reindex.direct.started", resourceType: "search_index", resourceId: "search-index", before: null, after: { eligible, operationId }, ip });
  try {
    const result = await rebuildIndex(1000);
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "search.reindex.direct.completed", resourceType: "search_index", resourceId: "search-index", before: null, after: { count: result.count, operationId }, ip });
    return { status: "COMPLETED" as const, count: result.count };
  } catch {
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "search.reindex.direct.failed", resourceType: "search_index", resourceId: "search-index", before: null, after: { operationId, reason: "Projection rebuild failed; inspect service logs." }, ip });
    throw new HttpError(503, "Rebuild failed. Search diagnostics recorded the failure; retry after service recovery.", "SEARCH_REINDEX_FAILED");
  }
}

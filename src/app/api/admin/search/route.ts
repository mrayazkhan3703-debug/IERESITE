import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-handler";
import { requirePermission, HttpError } from "@/server/auth";
import { indexStatus } from "@/server/search/service";
import { publicListingWhere } from "@/server/domain/visibility";
import { listingExclusionReasons } from "@/server/search/diagnostics";
import { readWorkerHealth } from "@/server/jobs/worker-health";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async () => {
  const actor = await requirePermission("jobs:read");
  if (!actor.roles.some((r) => ["OWNER", "ADMIN"].includes(r))) throw new HttpError(403, "Owner or Admin search operations access is required.");
  const [index, eligible, listings, documents, latest, audits, worker, pending] = await Promise.all([
    indexStatus(), db.listing.count({ where: publicListingWhere() }),
    db.listing.findMany({ take: 501, orderBy: { updatedAt: "desc" }, select: { id: true, publishedAt: true, expiresAt: true, availabilityStatus: true, property: { select: { id: true, slug: true, title: true, publicationStatus: true, deletedAt: true, lat: true, lng: true } } } }),
    db.searchDocument.findMany({ select: { listingId: true }, take: 10001 }),
    db.searchDocument.aggregate({ _max: { updatedAt: true } }),
    db.auditLog.findMany({ where: { resourceType: "search_index" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, createdAt: true, afterJson: true } }),
    readWorkerHealth(), db.outboxEvent.count({ where: { eventType: "search.reindex.requested", publishedAt: null } }),
  ]);
  const indexed = new Set(documents.map((d) => d.listingId));
  const diagnostics = listings.slice(0, 500).map((l) => { const reasons = listingExclusionReasons(l); if (!reasons.length && index.provider === "postgres" && !indexed.has(l.id)) reasons.push("MISSING_PROJECTION"); return { listingId: l.id, slug: l.property.slug, title: l.property.title, reasons, indexed: index.provider === "postgres" ? indexed.has(l.id) : null }; });
  return NextResponse.json({ index, eligible, latestIndexedAt: latest._max.updatedAt, worker, pendingRebuilds: pending, diagnostics, truncated: listings.length > 500 || documents.length > 10000, history: audits.map((a) => ({ ...a, details: JSON.parse(a.afterJson ?? "{}"), afterJson: undefined })) });
});

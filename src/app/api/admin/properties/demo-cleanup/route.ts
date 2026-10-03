import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, HttpError, requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { clientIp } from "@/server/rate-limit";
import { canManageCatalogResource } from "@/server/domain/resource-policy";
import { cleanupFingerprint, signCleanupPreview, requireCleanupPreview } from "@/server/domain/demo-cleanup-preview";
import { emitEvent } from "@/server/jobs/outbox";

export const dynamic = "force-dynamic";
const schema = z.object({ propertyIds: z.array(z.string().min(1).max(128)).min(1).max(100), mode: z.enum(["preview", "archive"]), previewToken: z.string().max(2000).optional() });

export const POST = apiHandler(async req => {
  const actor = await requirePermission("property:update");
  const input = schema.parse(await jsonBody(req));
  const ids = [...new Set(input.propertyIds)].sort();
  const config = getConfig();
  const key = config.IP_PSEUDONYM_KEY ?? (config.APP_ENV === "development" ? "development-cleanup-preview-not-for-hosting" : undefined);
  if (!key) throw new HttpError(503, "Cleanup signing configuration is unavailable.", "DEMO_CLEANUP_UNAVAILABLE");
  const operationId = input.previewToken ? cleanupFingerprint(input.previewToken) : null;
  return db.$transaction(async tx => {
    // Successful retry returns its receipt without touching records or media.
    if (input.mode === "archive" && operationId) {
      const applied = await tx.auditLog.findFirst({ where: { actorId: actor.id, resourceType: "demo_cleanup", resourceId: operationId, action: "demo.archive" } });
      if (applied) {
        const previous = JSON.parse(applied.afterJson ?? "{}");
        if (JSON.stringify(previous.propertyIds) !== JSON.stringify(ids)) throw new HttpError(409, "The cleanup receipt belongs to a different selection.", "DEMO_CLEANUP_PREVIEW_INVALID");
        return NextResponse.json({ ok: true, duplicateRequest: true, archivedCount: ids.length });
      }
    }
    const properties = await tx.property.findMany({ where: { id: { in: ids }, deletedAt: null }, orderBy: { id: "asc" }, include: { listings: { orderBy: { id: "asc" } } } });
    if (properties.length !== ids.length) throw new HttpError(404, "A selected property is no longer available.", "DEMO_CLEANUP_NOT_FOUND");
    for (const property of properties) {
      if (!canManageCatalogResource(actor, property.ownerOrganizationId)) throw new HttpError(403, "You cannot archive a selected record.", "RESOURCE_FORBIDDEN");
      if (!property.isDemoData && property.sourceType !== "DEMO_SEED") throw new HttpError(422, "Cleanup accepts only records with recorded demo provenance.", "DEMO_CLEANUP_REAL_RECORD");
      if (property.publicationStatus === "ARCHIVED") throw new HttpError(409, "A selected record is already archived. Refresh the selection.", "DEMO_CLEANUP_ARCHIVED");
    }
    const fingerprint = cleanupFingerprint(properties.map(p => ({ id: p.id, updatedAt: p.updatedAt, publicationStatus: p.publicationStatus, isDemoData: p.isDemoData, sourceType: p.sourceType, ownerOrganizationId: p.ownerOrganizationId, listings: p.listings.map(l => ({ id: l.id, updatedAt: l.updatedAt, availabilityStatus: l.availabilityStatus, publishedAt: l.publishedAt })) })));
    if (input.mode === "preview") return NextResponse.json({ previewToken: signCleanupPreview(actor.id, fingerprint, key), properties: properties.map(p => ({ id: p.id, title: p.title, publicationStatus: p.publicationStatus, listingCount: p.listings.length })), effect: "Withdraw listings and archive these properties. People, projects, and all media are retained." });
    requireCleanupPreview(input.previewToken ?? "", actor.id, fingerprint, key);
    for (const property of properties) {
      const updated = await tx.property.updateMany({ where: { id: property.id, updatedAt: property.updatedAt }, data: { publicationStatus: "ARCHIVED", updatedAt: new Date() } });
      if (updated.count !== 1) throw new HttpError(409, "A selected property changed. Review again.", "VERSION_CONFLICT");
      for (const listing of property.listings) {
        if (listing.availabilityStatus !== "WITHDRAWN") await tx.listingStatusHistory.create({ data: { listingId: listing.id, fromStatus: listing.availabilityStatus, toStatus: "WITHDRAWN", reason: "Reviewed Admin demo cleanup" } });
        await tx.listing.update({ where: { id: listing.id }, data: { availabilityStatus: "WITHDRAWN", publishedAt: null } });
      }
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "property.demo.archive", resourceType: "property", resourceId: property.id, before: { publicationStatus: property.publicationStatus, listings: property.listings.map(l => ({ id: l.id, availabilityStatus: l.availabilityStatus, publishedAt: l.publishedAt })) }, after: { publicationStatus: "ARCHIVED" }, ip: clientIp(req) }, tx);
      await emitEvent("property", property.id, "property.updated", { propertyId: property.id, by: actor.email }, tx);
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "demo.archive", resourceType: "demo_cleanup", resourceId: operationId!, before: null, after: { propertyIds: ids, retainedMedia: true, retainedPeople: true }, ip: clientIp(req) }, tx);
    return NextResponse.json({ ok: true, duplicateRequest: false, archivedCount: properties.length });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
});

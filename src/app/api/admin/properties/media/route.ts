import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, HttpError, requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { canManageCatalogResource } from "@/server/domain/resource-policy";
import { emitEvent } from "@/server/jobs/outbox";

export const dynamic = "force-dynamic";

const base = z.object({ propertyId: z.string().min(1) });
const schema = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("add-floor-plan"), mediaId: z.string().min(1), bedrooms: z.number().min(0).max(30).nullable().optional(), areaSqft: z.number().finite().positive().max(100_000_000).nullable().optional(), priceAed: z.number().finite().positive().max(1_000_000_000).nullable().optional(), label: z.string().trim().max(160).nullable().optional() }).strict(),
  base.extend({ action: z.literal("remove-floor-plan"), id: z.string().min(1) }).strict(),
  base.extend({ action: z.literal("add-document"), mediaId: z.string().min(1), docType: z.enum(["BROCHURE", "FLOOR_PLAN_PACK", "TITLE_DEED", "ESCALATION", "OTHER"]), label: z.string().trim().max(160).nullable().optional(), gated: z.boolean() }).strict(),
  base.extend({ action: z.literal("remove-document"), id: z.string().min(1) }).strict(),
]);

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("property:update");
  const input = schema.parse(await jsonBody<unknown>(req));
  return db.$transaction(async (tx) => {
    const property = await tx.property.findUnique({ where: { id: input.propertyId }, select: { id: true, ownerOrganizationId: true, deletedAt: true } });
    if (!property || property.deletedAt) throw new HttpError(404, "Property not found.", "NOT_FOUND");
    if (!canManageCatalogResource(actor, property.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this property.", "RESOURCE_FORBIDDEN");
    let result: { id?: string; removed?: boolean };
    if (input.action === "add-floor-plan") {
      const media = await tx.mediaAsset.findFirst({ where: { id: input.mediaId, isPrivate: false, OR: [{ kind: "FLOOR_PLAN" }, { mimeType: { startsWith: "image/" } }, { mimeType: "application/pdf" }] }, select: { id: true } });
      if (!media) throw new HttpError(422, "Choose a public image or PDF asset for this floor plan.", "MEDIA_VALIDATION");
      const floorPlan = await tx.propertyFloorPlan.create({ data: { propertyId: property.id, mediaId: media.id, bedrooms: input.bedrooms ?? null, areaSqft: input.areaSqft ?? null, priceMinor: input.priceAed == null ? null : BigInt(Math.round(input.priceAed * 100)), label: input.label?.trim() || null } });
      result = { id: floorPlan.id };
    } else if (input.action === "remove-floor-plan") {
      const row = await tx.propertyFloorPlan.findFirst({ where: { id: input.id, propertyId: property.id } });
      if (!row) throw new HttpError(404, "Floor plan not found.", "NOT_FOUND");
      await tx.propertyFloorPlan.delete({ where: { id: row.id } });
      result = { id: row.id, removed: true };
    } else if (input.action === "add-document") {
      if (input.docType === "TITLE_DEED" && !input.gated) throw new HttpError(422, "Title deed documents must require lead capture.", "DOCUMENT_PRIVACY_REQUIRED");
      const media = await tx.mediaAsset.findFirst({ where: { id: input.mediaId, isPrivate: false, mimeType: "application/pdf", kind: { in: ["DOCUMENT", "BROCHURE", "FLOOR_PLAN"] } }, select: { id: true } });
      if (!media) throw new HttpError(422, "Choose a public PDF document or brochure asset.", "MEDIA_VALIDATION");
      const document = await tx.propertyDocument.create({ data: { propertyId: property.id, mediaId: media.id, docType: input.docType, label: input.label?.trim() || null, gated: input.gated } });
      result = { id: document.id };
    } else {
      const row = await tx.propertyDocument.findFirst({ where: { id: input.id, propertyId: property.id } });
      if (!row) throw new HttpError(404, "Property document not found.", "NOT_FOUND");
      await tx.propertyDocument.delete({ where: { id: row.id } });
      result = { id: row.id, removed: true };
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `property.${input.action}`, resourceType: "property", resourceId: property.id, before: null, after: result, ip: clientIp(req) }, tx);
    await emitEvent("property", property.id, "property.updated", { propertyId: property.id, by: actor.email }, tx);
    return NextResponse.json(result, { status: input.action.startsWith("add-") ? 201 : 200 });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
});

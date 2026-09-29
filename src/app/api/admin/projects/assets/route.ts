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
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add-document"), projectId: z.string().min(1), mediaId: z.string().min(1), docType: z.enum(["BROCHURE", "FLOOR_PLAN_PACK", "ESCALATION", "OTHER"]), label: z.string().trim().max(160).nullable().optional(), gated: z.boolean() }).strict(),
  z.object({ action: z.literal("remove-document"), projectId: z.string().min(1), id: z.string().min(1) }).strict(),
]);

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = schema.parse(await jsonBody<unknown>(req));
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, ownerOrganizationId: true, deletedAt: true } });
    if (!project || project.deletedAt) throw new HttpError(404, "Project not found.", "NOT_FOUND");
    if (!canManageCatalogResource(actor, project.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this project.", "RESOURCE_FORBIDDEN");
    let result: { id: string; removed?: boolean };
    if (input.action === "add-document") {
      const media = await tx.mediaAsset.findFirst({ where: { id: input.mediaId, isPrivate: false, mimeType: "application/pdf", kind: { in: ["DOCUMENT", "BROCHURE", "FLOOR_PLAN"] } }, select: { id: true } });
      if (!media) throw new HttpError(422, "Choose a public PDF document or brochure asset.", "MEDIA_VALIDATION");
      const document = await tx.propertyDocument.create({ data: { projectId: project.id, mediaId: media.id, docType: input.docType, label: input.label?.trim() || null, gated: input.gated } });
      result = { id: document.id };
    } else {
      const document = await tx.propertyDocument.findFirst({ where: { id: input.id, projectId: project.id }, select: { id: true, mediaId: true, docType: true, label: true, gated: true } });
      if (!document) throw new HttpError(404, "Project document not found.", "NOT_FOUND");
      await tx.propertyDocument.delete({ where: { id: document.id } });
      result = { id: document.id, removed: true };
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `project.${input.action}`, resourceType: "project", resourceId: project.id, before: null, after: result, ip: clientIp(req) }, tx);
    await emitEvent("project", project.id, "project.updated", { projectId: project.id, documentId: result.id }, tx);
    return NextResponse.json(result, { status: result.removed ? 200 : 201 });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
});

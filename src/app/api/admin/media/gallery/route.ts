import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { attachGalleryMedia, removeGalleryMedia, updateGalleryMedia } from "@/server/domain/media-gallery-command";

export const dynamic = "force-dynamic";

const baseSchema = z.object({ entity: z.enum(["property", "project"]), entityId: z.string().min(1) });
const idsSchema = z.array(z.string().min(1)).min(1).max(50);
const attachSchema = baseSchema.extend({ action: z.literal("attach"), mediaIds: idsSchema }).strict();
const reorderSchema = baseSchema.extend({ action: z.literal("reorder"), mediaIds: z.array(z.string().min(1)).max(50), coverMediaId: z.string().min(1).nullable().optional() }).strict();
const detachSchema = baseSchema.extend({ action: z.literal("detach"), mediaIds: idsSchema }).strict();

export const POST = apiHandler(async (req) => {
  const raw = await jsonBody<unknown>(req);
  const input = attachSchema.parse(raw);
  const actor = await requirePermission(`${input.entity}:update`);
  return NextResponse.json(await attachGalleryMedia(actor, input.entity, input.entityId, input.mediaIds, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const raw = await jsonBody<unknown>(req);
  const input = reorderSchema.parse(raw);
  const actor = await requirePermission(`${input.entity}:update`);
  return NextResponse.json(await updateGalleryMedia(actor, input.entity, input.entityId, input.mediaIds, input.coverMediaId ?? null, clientIp(req)));
});

export const DELETE = apiHandler(async (req) => {
  const raw = await jsonBody<unknown>(req);
  const input = detachSchema.parse(raw);
  const actor = await requirePermission(`${input.entity}:update`);
  return NextResponse.json(await removeGalleryMedia(actor, input.entity, input.entityId, input.mediaIds, clientIp(req)));
});

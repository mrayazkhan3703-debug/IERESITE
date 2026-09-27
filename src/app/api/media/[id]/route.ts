import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import { requirePermission } from "@/server/auth";
import { z } from "zod";
import { updateMediaMetadata } from "@/server/domain/media-command";
import { clientIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET media asset metadata by id (public for published assets) */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const media = await db.mediaAsset.findFirst({ where: { id, isPrivate: false } });
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });
  return NextResponse.json({
    id: media.id,
    kind: media.kind,
    url: media.url,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    width: media.width,
    height: media.height,
    altText: media.altText,
  });
});

const metadataSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  altText: z.string().trim().max(300).nullable(),
  caption: z.string().trim().max(1000).nullable(),
}).strict();

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("media:update");
  const { id } = await ctx.params;
  const input = metadataSchema.parse(await jsonBody<z.infer<typeof metadataSchema>>(req));
  return NextResponse.json(await updateMediaMetadata(actor, {
    mediaAssetId: id,
    expectedUpdatedAt: input.expectedUpdatedAt,
    altText: input.altText,
    caption: input.caption,
  }, clientIp(req)));
});

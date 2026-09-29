import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-handler";
import { getPublicObject } from "@/server/storage/object-store";

export const dynamic = "force-dynamic";

const variants = new Set(["thumb", "card", "hero"]);

/** Public media is fetched by record ID; private portfolio objects are never addressable here. */
export const GET = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const asset = await db.mediaAsset.findFirst({
    where: { id, isPrivate: false },
    select: { id: true, kind: true, mimeType: true, storageKey: true },
  });
  if (!asset || !asset.storageKey.startsWith("public/media/")) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const requestedVariant = new URL(req.url).searchParams.get("variant");
  if (requestedVariant && (!variants.has(requestedVariant) || !asset.mimeType.startsWith("image/"))) {
    return NextResponse.json({ error: "Media variant not found" }, { status: 404 });
  }
  const key = requestedVariant ? `${asset.storageKey}.${requestedVariant}.webp` : asset.storageKey;
  const body = await getPublicObject(key);
  if (!body) return NextResponse.json({ error: "Media object not found" }, { status: 404 });

  const contentType = requestedVariant ? "image/webp" : asset.mimeType;
  const disposition = contentType.startsWith("image/") ? "inline" : "attachment";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${disposition}; filename="${asset.id}"`,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

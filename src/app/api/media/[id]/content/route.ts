import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-handler";
import { getPublicObject } from "@/server/storage/object-store";
import { requirePermission } from "@/server/auth";
import { parseByteRange } from "@/server/media/byte-range";
import { readLocalMedia } from "@/server/media/file-storage";
import { validReportDownloadGrant } from "@/server/media/download-grant";

export const dynamic = "force-dynamic";

const variants = new Set(["thumb", "card", "hero"]);

/** Public media is fetched by record ID; private portfolio objects are never addressable here. */
export const GET = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const asset = await db.mediaAsset.findFirst({
    where: { id, isPrivate: false },
    select: { id: true, kind: true, mimeType: true, storageKey: true, sizeBytes: true },
  });
  if (!asset || asset.storageKey.startsWith("private/")) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  const [protectedDocument, gatedReport] = await Promise.all([
    db.propertyDocument.findFirst({ where: { mediaId: id, OR: [{ gated: true }, { docType: { in: ["TITLE_DEED", "ESCALATION"] } }] }, select: { id: true } }),
    db.marketReport.findFirst({ where: { fileMediaId: id, gated: true }, select: { id: true } }),
  ]);
  const protectedDelivery = Boolean(protectedDocument || gatedReport);
  if (protectedDelivery && (protectedDocument || !await validReportDownloadGrant(new URL(req.url).searchParams.get("grant"), id))) await requirePermission("media:read");

  const requestedVariant = new URL(req.url).searchParams.get("variant");
  if (requestedVariant && (!variants.has(requestedVariant) || !asset.mimeType.startsWith("image/"))) {
    return NextResponse.json({ error: "Media variant not found" }, { status: 404 });
  }
  const objectStorage = asset.storageKey.startsWith("public/media/");
  const key = requestedVariant ? (objectStorage || asset.storageKey.startsWith("local/media/") ? `${asset.storageKey}.${requestedVariant}.webp` : `${asset.id}.${requestedVariant}.webp`) : asset.storageKey;
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader && asset.mimeType.startsWith("video/") ? parseByteRange(rangeHeader, asset.sizeBytes) : undefined;
  if (range === null) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.sizeBytes}`, "Cache-Control": "no-store" } });
  const body = objectStorage ? await getPublicObject(key, range) : await readLocalMedia(key, range);
  if (!body) return NextResponse.json({ error: "Media object not found" }, { status: 404 });

  const contentType = requestedVariant ? "image/webp" : asset.mimeType;
  const disposition = contentType.startsWith("image/") || contentType.startsWith("video/") ? "inline" : "attachment";
  return new Response(new Uint8Array(body), {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${disposition}; filename="${asset.id}"`,
      "Cache-Control": protectedDelivery || contentType === "application/pdf" ? "private, no-store" : "public, max-age=3600, stale-while-revalidate=86400",
      ...(asset.mimeType.startsWith("video/") ? { "Accept-Ranges": "bytes" } : {}),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${asset.sizeBytes}` } : {}),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(contentType === "application/pdf" ? { "Content-Security-Policy": "sandbox" } : {}),
    },
  });
});

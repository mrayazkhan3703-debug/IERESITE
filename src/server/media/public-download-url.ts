import { db } from "@/lib/db";

/** Return same-origin download paths only for currently public report documents. */
export async function publicDocumentDownloadUrls(mediaIds: string[]) {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const assets = await db.mediaAsset.findMany({
    where: {
      id: { in: ids }, isPrivate: false, mimeType: "application/pdf",
      OR: [{ storageKey: { startsWith: "public/media/" } }, { url: { startsWith: "/uploads/" } }],
    },
    select: { id: true, storageKey: true, url: true },
  });
  return new Map(assets.map((asset) => [
    asset.id,
    asset.storageKey.startsWith("public/media/") ? `/api/media/${encodeURIComponent(asset.id)}/content` : asset.url,
  ]));
}

export async function publicDocumentDownloadUrl(mediaId: string | null) {
  return (await publicDocumentDownloadUrls(mediaId ? [mediaId] : [])).get(mediaId ?? "") ?? null;
}

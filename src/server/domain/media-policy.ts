import type { Prisma } from "@prisma/client";
import { HttpError } from "@/server/auth";

export async function requirePublicMedia(
  tx: Prisma.TransactionClient,
  mediaAssetId: string | null | undefined,
  allowedKinds: readonly string[],
): Promise<string | null> {
  if (!mediaAssetId) return null;
  const media = await tx.mediaAsset.findFirst({
    where: { id: mediaAssetId, isPrivate: false, kind: { in: [...allowedKinds] } },
    select: { id: true },
  });
  if (!media) throw new HttpError(422, "Choose an available public asset of the required type from the Media Library.", "MEDIA_NOT_AVAILABLE");
  return media.id;
}

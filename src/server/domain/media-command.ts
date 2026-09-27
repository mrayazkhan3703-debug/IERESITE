import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";

export interface MediaMetadataInput {
  mediaAssetId: string;
  expectedUpdatedAt: string;
  altText?: string | null;
  caption?: string | null;
}

export async function updateMediaMetadata(actor: SessionUser, input: MediaMetadataInput, ip: string | null) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid media version", "INVALID_VERSION");
  const altText = input.altText?.trim() || null;
  const caption = input.caption?.trim() || null;

  try {
    return await db.$transaction(async (tx) => {
      const media = await tx.mediaAsset.findUnique({ where: { id: input.mediaAssetId } });
      if (!media || media.isPrivate) throw new HttpError(404, "Public media asset not found", "NOT_FOUND");
      if (media.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This media asset changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      }
      const changed = await tx.mediaAsset.updateMany({
        where: { id: media.id, isPrivate: false, updatedAt: expectedUpdatedAt },
        data: { altText, caption, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "This media asset changed during the save. Refresh and retry.", "VERSION_CONFLICT");
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: "media.metadata_update",
        resourceType: "media", resourceId: media.id,
        before: { altText: media.altText, caption: media.caption }, after: { altText, caption }, ip,
      }, tx);
      await emitEvent("media", media.id, "media.updated", { mediaId: media.id, by: actor.email }, tx);
      const updated = await tx.mediaAsset.findUniqueOrThrow({ where: { id: media.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This media asset changed during the save. Refresh and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

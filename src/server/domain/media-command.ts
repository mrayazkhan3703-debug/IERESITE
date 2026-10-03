import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import fs from "fs/promises";
import { localMediaPath } from "@/server/media/file-storage";
import { deletePublicObject } from "@/server/storage/object-store";
import { requireStorageWrites } from "@/server/storage/mutation-policy";

export interface MediaMetadataInput {
  mediaAssetId: string;
  expectedUpdatedAt: string;
  altText?: string | null;
  caption?: string | null;
  posterMediaId?: string | null;
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
      if (input.posterMediaId !== undefined && !media.mimeType.startsWith("video/")) throw new HttpError(422, "Only videos can have a poster.", "INVALID_POSTER");
      if (input.posterMediaId && !await tx.mediaAsset.findFirst({ where: { id: input.posterMediaId, isPrivate: false, mimeType: { startsWith: "image/" } } })) throw new HttpError(422, "Choose a public image as the video poster.", "INVALID_POSTER");
      const changed = await tx.mediaAsset.updateMany({
        where: { id: media.id, isPrivate: false, updatedAt: expectedUpdatedAt },
        data: { ...(input.altText !== undefined ? { altText } : {}), ...(input.caption !== undefined ? { caption } : {}), ...(input.posterMediaId !== undefined ? { posterMediaId: input.posterMediaId } : {}), updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "This media asset changed during the save. Refresh and retry.", "VERSION_CONFLICT");
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: "media.metadata_update",
        resourceType: "media", resourceId: media.id,
        before: { altText: media.altText, caption: media.caption, posterMediaId: media.posterMediaId }, after: { altText: input.altText === undefined ? media.altText : altText, caption: input.caption === undefined ? media.caption : caption, posterMediaId: input.posterMediaId === undefined ? media.posterMediaId : input.posterMediaId }, ip,
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

/** Permanently remove an unreferenced public asset only; anything used downstream is protected. */
export async function deleteUnusedMedia(actor: SessionUser, mediaAssetId: string, ip: string | null) {
  requireStorageWrites();
  const media = await db.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (!asset || asset.isPrivate) throw new HttpError(404, "Public media asset not found.", "NOT_FOUND");
    const [propertyMedia, projectMedia, floorPlans, documents, portfolioDocuments, agents, projects, developers, communities, contentCovers, contentHeroes, reportsCovers, reportsFiles, seo] = await Promise.all([
      tx.propertyMedia.count({ where: { mediaId: asset.id } }), tx.projectMedia.count({ where: { mediaId: asset.id } }),
      tx.propertyFloorPlan.count({ where: { mediaId: asset.id } }), tx.propertyDocument.count({ where: { mediaId: asset.id } }),
      tx.portfolioDocument.count({ where: { mediaAssetId: asset.id } }), tx.agent.count({ where: { photoMediaId: asset.id } }),
      tx.project.count({ where: { brochureMediaId: asset.id } }), tx.developer.count({ where: { logoMediaId: asset.id } }),
      tx.community.count({ where: { imageMediaId: asset.id } }), tx.contentEntry.count({ where: { coverMediaId: asset.id } }),
      tx.contentEntry.count({ where: { heroImageMediaId: asset.id } }), tx.marketReport.count({ where: { coverMediaId: asset.id } }),
      tx.marketReport.count({ where: { fileMediaId: asset.id } }), tx.seoMetadata.count({ where: { ogImageMediaId: asset.id } }),
    ]);
    const retainedUses = await Promise.all([
      tx.mediaAsset.count({ where: { posterMediaId: asset.id } }),
      tx.contentEntry.count({ where: { bodyJson: { contains: asset.id } } }),
      tx.siteSetting.count({ where: { settingsJson: { contains: asset.id } } }),
      tx.contentRevision.count({ where: { snapshotJson: { contains: asset.id } } }),
      tx.siteSettingRevision.count({ where: { snapshotJson: { contains: asset.id } } }),
      tx.marketReportRevision.count({ where: { snapshotJson: { contains: asset.id } } }),
      tx.seoMetadataRevision.count({ where: { snapshotJson: { contains: asset.id } } }),
    ]);
    const uses = propertyMedia + projectMedia + floorPlans + documents + portfolioDocuments + agents + projects + developers + communities + contentCovers + contentHeroes + reportsCovers + reportsFiles + seo + retainedUses.reduce((sum, count) => sum + count, 0);
    if (uses) throw new HttpError(409, `This asset has ${uses} tracked use${uses === 1 ? "" : "s"}; detach or replace those references before deleting it.`, "MEDIA_IN_USE");
    await tx.mediaProcessingJob.deleteMany({ where: { mediaId: asset.id } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "media.delete", resourceType: "media", resourceId: asset.id, before: { storageKey: asset.storageKey, kind: asset.kind, sizeBytes: asset.sizeBytes }, after: null, ip }, tx);
    await emitEvent("media", asset.id, "media.updated", { mediaId: asset.id, deleted: true, by: actor.email }, tx);
    await tx.mediaAsset.delete({ where: { id: asset.id } });
    return asset;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const objectStorage = media.storageKey.startsWith("public/media/");
  const keys = [media.storageKey, ...["thumb", "card", "hero"].map((variant) => objectStorage || media.storageKey.startsWith("local/media/") ? `${media.storageKey}.${variant}.webp` : `${media.id}.${variant}.webp`)];
  const cleanup = await Promise.allSettled(keys.map(async (key) => {
    if (objectStorage) await deletePublicObject(key);
    else await fs.unlink(localMediaPath(key));
  }));
  return { ok: true as const, cleanupComplete: cleanup.every((item) => item.status === "fulfilled") };
}

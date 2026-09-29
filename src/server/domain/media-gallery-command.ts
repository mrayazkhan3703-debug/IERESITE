import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { audit, HttpError } from "@/server/auth";
import { canManageCatalogResource } from "@/server/domain/resource-policy";
import { emitEvent } from "@/server/jobs/outbox";

type Entity = "property" | "project";
type ProjectSection = "GALLERY" | "PROGRESS";
type Tx = Prisma.TransactionClient;

function projectSection(entity: Entity, section?: ProjectSection): ProjectSection {
  return entity === "project" ? section ?? "GALLERY" : "GALLERY";
}

async function authorizeEntity(tx: Tx, actor: SessionUser, entity: Entity, id: string) {
  const record = entity === "property"
    ? await tx.property.findUnique({ where: { id }, select: { id: true, ownerOrganizationId: true, deletedAt: true } })
    : await tx.project.findUnique({ where: { id }, select: { id: true, ownerOrganizationId: true, deletedAt: true } });
  if (!record || record.deletedAt) throw new HttpError(404, `${entity} not found`, "NOT_FOUND");
  if (!canManageCatalogResource(actor, record.ownerOrganizationId)) throw new HttpError(403, `You cannot manage this ${entity}.`, "RESOURCE_FORBIDDEN");
}

export async function attachGalleryMedia(actor: SessionUser, entity: Entity, entityId: string, mediaIds: string[], ip: string | null, section?: ProjectSection) {
  return db.$transaction(async (tx) => {
    await authorizeEntity(tx, actor, entity, entityId);
    const ids = [...new Set(mediaIds)];
    const assets = await tx.mediaAsset.findMany({ where: { id: { in: ids }, isPrivate: false }, select: { id: true, kind: true } });
    if (assets.length !== ids.length || assets.some((asset) => asset.kind !== "IMAGE")) throw new HttpError(422, "Choose existing public image assets only.", "MEDIA_VALIDATION");
    const current = entity === "property"
      ? await tx.propertyMedia.findMany({ where: { propertyId: entityId }, orderBy: { sortOrder: "asc" }, select: { mediaId: true, sortOrder: true, isCover: true } })
      : await tx.projectMedia.findMany({ where: { projectId: entityId, section: projectSection(entity, section) }, orderBy: { sortOrder: "asc" }, select: { mediaId: true, sortOrder: true } });
    const existing = new Set(current.map((item) => item.mediaId));
    const added = ids.filter((id) => !existing.has(id));
    for (const mediaId of added) {
      if (entity === "property") await tx.propertyMedia.create({ data: { propertyId: entityId, mediaId, sortOrder: current.length + added.indexOf(mediaId), isCover: current.length === 0 && added.indexOf(mediaId) === 0 } });
      else await tx.projectMedia.create({ data: { projectId: entityId, mediaId, section: projectSection(entity, section), sortOrder: current.length + added.indexOf(mediaId) } });
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `${entity}.media_attach`, resourceType: entity, resourceId: entityId, before: current.map((row) => row.mediaId), after: { section: projectSection(entity, section), mediaIds: [...current.map((row) => row.mediaId), ...added] }, ip }, tx);
    await emitEvent(entity, entityId, `${entity}.updated`, { [`${entity}Id`]: entityId, by: actor.email }, tx);
    const coverMediaId = entity === "property" ? current.find((row) => "isCover" in row && row.isCover)?.mediaId ?? (current.length === 0 ? added[0] ?? null : null) : null;
    return { mediaIds: [...current.map((row) => row.mediaId), ...added], coverMediaId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateGalleryMedia(actor: SessionUser, entity: Entity, entityId: string, mediaIds: string[], coverMediaId: string | null, ip: string | null, section?: ProjectSection) {
  return db.$transaction(async (tx) => {
    await authorizeEntity(tx, actor, entity, entityId);
    if (new Set(mediaIds).size !== mediaIds.length || (coverMediaId && !mediaIds.includes(coverMediaId))) throw new HttpError(422, "Gallery order must be unique and its cover must be in the gallery.", "MEDIA_VALIDATION");
    const current = entity === "property"
      ? await tx.propertyMedia.findMany({ where: { propertyId: entityId }, orderBy: { sortOrder: "asc" }, select: { mediaId: true, isCover: true } })
      : await tx.projectMedia.findMany({ where: { projectId: entityId, section: projectSection(entity, section) }, orderBy: { sortOrder: "asc" }, select: { mediaId: true } });
    const currentIds = current.map((row) => row.mediaId);
    if (mediaIds.length !== currentIds.length || mediaIds.some((id) => !currentIds.includes(id))) throw new HttpError(409, "Gallery changed. Refresh before saving its order.", "VERSION_CONFLICT");
    if (entity === "property") {
      for (let sortOrder = 0; sortOrder < mediaIds.length; sortOrder += 1) {
        await tx.propertyMedia.updateMany({ where: { propertyId: entityId, mediaId: mediaIds[sortOrder] }, data: { sortOrder, isCover: mediaIds[sortOrder] === coverMediaId } });
      }
    } else {
      for (let sortOrder = 0; sortOrder < mediaIds.length; sortOrder += 1) {
        await tx.projectMedia.updateMany({ where: { projectId: entityId, section: projectSection(entity, section), mediaId: mediaIds[sortOrder] }, data: { sortOrder } });
      }
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `${entity}.media_reorder`, resourceType: entity, resourceId: entityId, before: { section: projectSection(entity, section), mediaIds: currentIds }, after: { section: projectSection(entity, section), mediaIds }, ip }, tx);
    await emitEvent(entity, entityId, `${entity}.updated`, { [`${entity}Id`]: entityId, by: actor.email }, tx);
    return { mediaIds, coverMediaId: entity === "property" ? coverMediaId : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function removeGalleryMedia(actor: SessionUser, entity: Entity, entityId: string, mediaIds: string[], ip: string | null, section?: ProjectSection) {
  return db.$transaction(async (tx) => {
    await authorizeEntity(tx, actor, entity, entityId);
    const current = entity === "property"
      ? await tx.propertyMedia.findMany({ where: { propertyId: entityId }, orderBy: { sortOrder: "asc" }, select: { mediaId: true, isCover: true } })
      : await tx.projectMedia.findMany({ where: { projectId: entityId, section: projectSection(entity, section) }, orderBy: { sortOrder: "asc" }, select: { mediaId: true } });
    if (mediaIds.some((id) => !current.some((row) => row.mediaId === id))) throw new HttpError(404, "One or more selected assets are not in this gallery.", "NOT_FOUND");
    if (entity === "property") await tx.propertyMedia.deleteMany({ where: { propertyId: entityId, mediaId: { in: mediaIds } } });
    else await tx.projectMedia.deleteMany({ where: { projectId: entityId, section: projectSection(entity, section), mediaId: { in: mediaIds } } });
    const remaining = current.filter((row) => !mediaIds.includes(row.mediaId)).map((row) => row.mediaId);
    if (entity === "property") {
      const currentCoverRemains = current.some((row) => "isCover" in row && row.isCover && remaining.includes(row.mediaId));
      for (let sortOrder = 0; sortOrder < remaining.length; sortOrder += 1) {
        const wasCover = current.some((row) => row.mediaId === remaining[sortOrder] && "isCover" in row && row.isCover);
        await tx.propertyMedia.updateMany({ where: { propertyId: entityId, mediaId: remaining[sortOrder] }, data: { sortOrder, isCover: currentCoverRemains ? wasCover : sortOrder === 0 } });
      }
    } else {
      for (let sortOrder = 0; sortOrder < remaining.length; sortOrder += 1) await tx.projectMedia.updateMany({ where: { projectId: entityId, section: projectSection(entity, section), mediaId: remaining[sortOrder] }, data: { sortOrder } });
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `${entity}.media_detach`, resourceType: entity, resourceId: entityId, before: { section: projectSection(entity, section), mediaIds: current.map((row) => row.mediaId) }, after: { section: projectSection(entity, section), mediaIds: remaining }, ip }, tx);
    await emitEvent(entity, entityId, `${entity}.updated`, { [`${entity}Id`]: entityId, by: actor.email }, tx);
    const coverMediaId = entity === "property" ? (remaining.find((id) => current.some((row) => row.mediaId === id && "isCover" in row && row.isCover)) ?? remaining[0] ?? null) : null;
    return { mediaIds: remaining, coverMediaId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

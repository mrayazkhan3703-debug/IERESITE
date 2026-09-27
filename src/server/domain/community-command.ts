import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { requirePublicMedia } from "@/server/domain/media-policy";
import { canCreateCatalogResource, canManageCatalogResource } from "@/server/domain/resource-policy";

export interface CommunityCommandInput {
  communityId: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  summary?: string | null;
  description?: string | null;
  areaType?: string;
  lat?: number;
  lng?: number;
  publicationStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | "UNPUBLISHED";
  imageMediaId?: string | null;
}

export interface NewCommunityCommandInput {
  name: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  areaType: string;
  lat: number;
  lng: number;
  locationPrecision: "EXACT" | "COMMUNITY_CENTROID" | "APPROXIMATE";
  imageMediaId?: string | null;
}

export async function createCommunityCommand(actor: SessionUser, input: NewCommunityCommandInput, ip: string | null) {
  if (!canCreateCatalogResource(actor)) throw new HttpError(403, "Catalog creation requires an organization-scoped staff role.", "RESOURCE_FORBIDDEN");
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpError(422, "Community name and a URL-safe slug are required.", "COMMUNITY_VALIDATION");
  }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90 || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new HttpError(422, "Valid coordinates are required before creating a community.", "COMMUNITY_VALIDATION");
  }

  try {
    return await db.$transaction(async (tx) => {
      const imageMediaId = await requirePublicMedia(tx, input.imageMediaId, ["IMAGE"]);
      const community = await tx.community.create({
        data: {
          ownerOrganizationId: actor.organizationId,
          name,
          slug,
          summary: input.summary?.trim() || null,
          description: input.description?.trim() || null,
          areaType: input.areaType,
          lat: input.lat,
          lng: input.lng,
          locationPrecision: input.locationPrecision,
          locationSourceType: "MANUAL_ADMIN",
          sourceType: "INTERNAL",
          publicationStatus: "DRAFT",
          imageMediaId,
          isDemoData: false,
        },
      });
      const after = {
        name: community.name, slug: community.slug, summary: community.summary, description: community.description,
        areaType: community.areaType, lat: community.lat, lng: community.lng,
        locationPrecision: community.locationPrecision, locationSourceType: community.locationSourceType,
        publicationStatus: community.publicationStatus, imageMediaId: community.imageMediaId,
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "community.create", resourceType: "community", resourceId: community.id, before: null, after, ip }, tx);
      await emitEvent("community", community.id, "community.updated", { communityId: community.id, by: actor.email }, tx);
      return { id: community.id, updatedAt: community.updatedAt.toISOString(), publicationStatus: community.publicationStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That community slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "The community changed during creation. Review and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

export async function updateCommunityCommand(actor: SessionUser, input: CommunityCommandInput, ip: string | null) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid community version", "INVALID_VERSION");

  try {
    return await db.$transaction(async (tx) => {
      const community = await tx.community.findUnique({ where: { id: input.communityId } });
      if (!community) throw new HttpError(404, "Community not found", "NOT_FOUND");
      if (!canManageCatalogResource(actor, community.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this community record.", "RESOURCE_FORBIDDEN");
      if (community.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This community changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const name = input.name?.trim() ?? community.name;
      const slug = input.slug?.trim().toLowerCase() ?? community.slug;
      const lat = input.lat ?? community.lat;
      const lng = input.lng ?? community.lng;
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new HttpError(422, "Community name and a URL-safe slug are required.", "COMMUNITY_VALIDATION");
      }
      if (input.publicationStatus === "PUBLISHED" && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) {
        throw new HttpError(422, "Valid community coordinates are required before publishing.", "PUBLICATION_VALIDATION");
      }
      if (input.publicationStatus && input.publicationStatus !== "PUBLISHED") {
        const publishedProjects = await tx.project.count({ where: { communityId: community.id, publicationStatus: "PUBLISHED", deletedAt: null } });
        if (publishedProjects > 0) {
          throw new HttpError(409, "Unpublish or move all published projects before hiding this community.", "PUBLISHED_PROJECTS_EXIST");
        }
        const publishedProperties = await tx.property.count({ where: { communityId: community.id, publicationStatus: "PUBLISHED", deletedAt: null } });
        if (publishedProperties > 0) {
          throw new HttpError(409, "Unpublish or move all published properties before hiding this community.", "PUBLISHED_PROPERTIES_EXIST");
        }
      }

      const imageMediaId = input.imageMediaId === undefined
        ? community.imageMediaId
        : await requirePublicMedia(tx, input.imageMediaId, ["IMAGE"]);

      const before = {
        name: community.name, slug: community.slug, summary: community.summary, description: community.description,
        areaType: community.areaType, lat: community.lat, lng: community.lng, publicationStatus: community.publicationStatus,
        imageMediaId: community.imageMediaId,
      };
      const data: Prisma.CommunityUpdateManyMutationInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = name;
      if (input.slug !== undefined) data.slug = slug;
      if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.areaType !== undefined) data.areaType = input.areaType;
      if (input.lat !== undefined) data.lat = input.lat;
      if (input.lng !== undefined) data.lng = input.lng;
      if (input.publicationStatus !== undefined) data.publicationStatus = input.publicationStatus;
      if (input.imageMediaId !== undefined) data.imageMediaId = imageMediaId;

      const changed = await tx.community.updateMany({
        where: { id: community.id, updatedAt: expectedUpdatedAt },
        data,
      });
      if (changed.count !== 1) throw new HttpError(409, "This community changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");

      if (slug !== community.slug) {
        const fromPath = `/communities/${community.slug}`;
        const toPath = `/communities/${slug}`;
        await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
        const redirect = await tx.redirect.findUnique({ where: { fromPath } });
        if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Community slug changed in Admin" } });
        else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Community slug changed in Admin" } });
      }
      const after = {
        name, slug,
        summary: input.summary === undefined ? community.summary : input.summary?.trim() || null,
        description: input.description === undefined ? community.description : input.description?.trim() || null,
        areaType: input.areaType ?? community.areaType,
        lat, lng,
        publicationStatus: input.publicationStatus ?? community.publicationStatus,
        imageMediaId,
      };
      await audit({
        actorId: actor.id, organizationId: actor.organizationId,
        action: input.publicationStatus === "PUBLISHED" ? "community.publish" : "community.update",
        resourceType: "community", resourceId: community.id, before, after, ip,
      }, tx);
      await emitEvent("community", community.id, "community.updated", { communityId: community.id, by: actor.email }, tx);
      const updated = await tx.community.findUniqueOrThrow({ where: { id: community.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That community slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This community changed during the save. Refresh and review the latest values.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

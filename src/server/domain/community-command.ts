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
  parentLocationId?: string | null;
  summary?: string | null;
  description?: string | null;
  areaType?: string;
  lat?: number;
  lng?: number;
  avgPricePerSqftMinor?: string | null;
  currency?: string;
  locationPrecision?: "EXACT" | "COMMUNITY_CENTROID" | "APPROXIMATE" | "UNAVAILABLE";
  boundaryJson?: string | null;
  radiusMeters?: number;
  lifestyleTags?: string[];
  transport?: Record<string, unknown>[];
  schools?: Record<string, unknown>[];
  healthcare?: Record<string, unknown>[];
  retail?: Record<string, unknown>[];
  sourceType?: string;
  sourceUpdatedAt?: string | null;
  locationSourceType?: string | null;
  locationSourceId?: string | null;
  publicationStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | "UNPUBLISHED";
  imageMediaId?: string | null;
}

export interface NewCommunityCommandInput {
  name: string;
  slug: string;
  parentLocationId?: string | null;
  summary?: string | null;
  description?: string | null;
  areaType: string;
  lat: number;
  lng: number;
  avgPricePerSqftMinor?: string | null;
  currency?: string;
  locationPrecision: "EXACT" | "COMMUNITY_CENTROID" | "APPROXIMATE";
  boundaryJson?: string | null;
  radiusMeters?: number;
  lifestyleTags?: string[];
  transport?: Record<string, unknown>[];
  schools?: Record<string, unknown>[];
  healthcare?: Record<string, unknown>[];
  retail?: Record<string, unknown>[];
  sourceType?: string;
  sourceUpdatedAt?: string | null;
  locationSourceType?: string | null;
  locationSourceId?: string | null;
  imageMediaId?: string | null;
}

function validateCommunityFacts(input: { boundaryJson?: string | null; radiusMeters?: number; lifestyleTags?: string[]; transport?: Record<string, unknown>[]; schools?: Record<string, unknown>[]; healthcare?: Record<string, unknown>[]; retail?: Record<string, unknown>[]; sourceUpdatedAt?: string | null }) {
  if (input.radiusMeters !== undefined && (!Number.isInteger(input.radiusMeters) || input.radiusMeters < 0 || input.radiusMeters > 100_000)) {
    throw new HttpError(422, "Community radius must be a whole number from 0 to 100,000 metres.", "COMMUNITY_RADIUS_INVALID");
  }
  if (input.boundaryJson) {
    let geo: unknown;
    try { geo = JSON.parse(input.boundaryJson); } catch { throw new HttpError(422, "Community boundary must be valid GeoJSON.", "COMMUNITY_BOUNDARY_INVALID"); }
    const geometry = geo && typeof geo === "object" ? geo as Record<string, unknown> : {};
    if (!["Polygon", "MultiPolygon"].includes(String(geometry.type)) || !Array.isArray(geometry.coordinates)) throw new HttpError(422, "Community boundary must be a GeoJSON Polygon or MultiPolygon.", "COMMUNITY_BOUNDARY_INVALID");
    const validatePositions = (value: unknown, depth: number): boolean => {
      if (depth === 0) return Array.isArray(value) && value.length >= 2 && value.every((coordinate, index) => typeof coordinate === "number" && Number.isFinite(coordinate) && (index === 0 ? coordinate >= -180 && coordinate <= 180 : coordinate >= -90 && coordinate <= 90));
      if (!Array.isArray(value) || value.length < (depth === 1 ? 4 : 1) || !value.every((child) => validatePositions(child, depth - 1))) return false;
      if (depth === 1) {
        const first = value[0]; const last = value[value.length - 1];
        return Array.isArray(first) && Array.isArray(last) && first.length >= 2 && last.length >= 2 && first[0] === last[0] && first[1] === last[1];
      }
      return true;
    };
    const depth = geometry.type === "Polygon" ? 2 : 3;
    if (!validatePositions(geometry.coordinates, depth)) throw new HttpError(422, "Community boundary coordinates must contain valid closed polygon rings.", "COMMUNITY_BOUNDARY_INVALID");
  }
  for (const [name, values] of Object.entries({ lifestyleTags: input.lifestyleTags, transport: input.transport, schools: input.schools, healthcare: input.healthcare, retail: input.retail })) {
    if (values && values.length > 100) throw new HttpError(422, `${name} is limited to 100 entries.`, "COMMUNITY_FACTS_INVALID");
  }
  for (const field of ["transport", "schools", "healthcare", "retail"] as const) {
    for (const item of input[field] ?? []) {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !item.name.trim() || item.name.length > 160) throw new HttpError(422, `${field} entries need a name up to 160 characters.`, "COMMUNITY_FACTS_INVALID");
    }
  }
  if (input.sourceUpdatedAt && !Number.isFinite(new Date(input.sourceUpdatedAt).getTime())) throw new HttpError(422, "Source update time is invalid.", "COMMUNITY_SOURCE_DATE_INVALID");
}

function validateCommunityPrice(value?: string | null, currency?: string) {
  if (value != null && (!/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) > 9_223_372_036_854_775_807n)) throw new HttpError(422, "Average price per square foot must fit in a positive PostgreSQL minor-unit amount.", "COMMUNITY_PRICE_INVALID");
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency.toUpperCase())) throw new HttpError(422, "Choose a three-letter currency code.", "COMMUNITY_CURRENCY_INVALID");
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
  validateCommunityFacts(input);
  validateCommunityPrice(input.avgPricePerSqftMinor, input.currency);

  try {
    return await db.$transaction(async (tx) => {
      const parentLocationId = input.parentLocationId?.trim() || null;
      if (parentLocationId && !await tx.location.findUnique({ where: { id: parentLocationId }, select: { id: true } })) throw new HttpError(422, "Choose a valid parent location.", "COMMUNITY_PARENT_LOCATION_INVALID");
      const imageMediaId = await requirePublicMedia(tx, input.imageMediaId, ["IMAGE"]);
      const community = await tx.community.create({
        data: {
          ownerOrganizationId: actor.organizationId,
          parentLocationId,
          name,
          slug,
          summary: input.summary?.trim() || null,
          description: input.description?.trim() || null,
          areaType: input.areaType,
          lat: input.lat,
          lng: input.lng,
          avgPricePerSqftMinor: input.avgPricePerSqftMinor ? BigInt(input.avgPricePerSqftMinor) : null,
          currency: input.currency?.trim().toUpperCase() || "AED",
          locationPrecision: input.locationPrecision,
          boundaryJson: input.boundaryJson?.trim() || null,
          radiusMeters: input.radiusMeters ?? 2500,
          lifestyleTagsJson: JSON.stringify(input.lifestyleTags ?? []),
          transportJson: JSON.stringify(input.transport ?? []), schoolsJson: JSON.stringify(input.schools ?? []),
          healthcareJson: JSON.stringify(input.healthcare ?? []), retailJson: JSON.stringify(input.retail ?? []),
          locationSourceType: input.locationSourceType?.trim() || "MANUAL_ADMIN",
          locationSourceId: input.locationSourceId?.trim() || null,
          sourceType: input.sourceType?.trim() || "INTERNAL",
          sourceUpdatedAt: input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null,
          retrievedAt: input.sourceUpdatedAt ? new Date() : null,
          publicationStatus: "DRAFT",
          imageMediaId,
          isDemoData: false,
        },
      });
      const after = {
        parentLocationId: community.parentLocationId, name: community.name, slug: community.slug, summary: community.summary, description: community.description,
        areaType: community.areaType, lat: community.lat, lng: community.lng,
        avgPricePerSqftMinor: community.avgPricePerSqftMinor?.toString() ?? null, currency: community.currency,
        locationPrecision: community.locationPrecision, locationSourceType: community.locationSourceType,
        boundaryJson: community.boundaryJson, radiusMeters: community.radiusMeters, lifestyleTagsJson: community.lifestyleTagsJson,
        transportJson: community.transportJson, schoolsJson: community.schoolsJson, healthcareJson: community.healthcareJson, retailJson: community.retailJson,
        sourceType: community.sourceType, sourceUpdatedAt: community.sourceUpdatedAt,
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
      validateCommunityFacts(input);
      validateCommunityPrice(input.avgPricePerSqftMinor, input.currency);
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new HttpError(422, "Community name and a URL-safe slug are required.", "COMMUNITY_VALIDATION");
      }
      const imageMediaId = input.imageMediaId === undefined
        ? community.imageMediaId
        : await requirePublicMedia(tx, input.imageMediaId, ["IMAGE"]);
      const parentLocationId = input.parentLocationId === undefined ? community.parentLocationId : input.parentLocationId?.trim() || null;
      if (parentLocationId && !await tx.location.findUnique({ where: { id: parentLocationId }, select: { id: true } })) throw new HttpError(422, "Choose a valid parent location.", "COMMUNITY_PARENT_LOCATION_INVALID");
      if (input.publicationStatus === "PUBLISHED") {
        const precision = input.locationPrecision ?? community.locationPrecision;
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || precision === "UNAVAILABLE") {
          throw new HttpError(422, "Valid coordinates and a usable precision are required before publishing.", "PUBLICATION_VALIDATION");
        }
        if (!(input.summary ?? community.summary)?.trim() || !(input.description ?? community.description)?.trim() || !imageMediaId) {
          throw new HttpError(422, "Add a summary, description, and public cover image before publishing this community.", "PUBLICATION_VALIDATION");
        }
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

      const before = {
        parentLocationId: community.parentLocationId, name: community.name, slug: community.slug, summary: community.summary, description: community.description,
        areaType: community.areaType, lat: community.lat, lng: community.lng, publicationStatus: community.publicationStatus,
        avgPricePerSqftMinor: community.avgPricePerSqftMinor?.toString() ?? null, currency: community.currency,
        imageMediaId: community.imageMediaId, locationPrecision: community.locationPrecision, boundaryJson: community.boundaryJson,
        radiusMeters: community.radiusMeters, lifestyleTagsJson: community.lifestyleTagsJson, transportJson: community.transportJson,
        schoolsJson: community.schoolsJson, healthcareJson: community.healthcareJson, retailJson: community.retailJson,
        sourceType: community.sourceType, sourceUpdatedAt: community.sourceUpdatedAt,
      };
      const data: Prisma.CommunityUncheckedUpdateManyInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = name;
      if (input.slug !== undefined) data.slug = slug;
      if (input.parentLocationId !== undefined) data.parentLocationId = parentLocationId;
      if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.areaType !== undefined) data.areaType = input.areaType;
      if (input.lat !== undefined) data.lat = input.lat;
      if (input.lng !== undefined) data.lng = input.lng;
      if (input.avgPricePerSqftMinor !== undefined) data.avgPricePerSqftMinor = input.avgPricePerSqftMinor ? BigInt(input.avgPricePerSqftMinor) : null;
      if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase();
      if (input.locationPrecision !== undefined) data.locationPrecision = input.locationPrecision;
      if (input.boundaryJson !== undefined) data.boundaryJson = input.boundaryJson?.trim() || null;
      if (input.radiusMeters !== undefined) data.radiusMeters = input.radiusMeters;
      if (input.lifestyleTags !== undefined) data.lifestyleTagsJson = JSON.stringify(input.lifestyleTags);
      if (input.transport !== undefined) data.transportJson = JSON.stringify(input.transport);
      if (input.schools !== undefined) data.schoolsJson = JSON.stringify(input.schools);
      if (input.healthcare !== undefined) data.healthcareJson = JSON.stringify(input.healthcare);
      if (input.retail !== undefined) data.retailJson = JSON.stringify(input.retail);
      if (input.sourceType !== undefined) data.sourceType = input.sourceType.trim();
      if (input.sourceUpdatedAt !== undefined) { data.sourceUpdatedAt = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null; data.retrievedAt = input.sourceUpdatedAt ? new Date() : null; }
      if (input.locationSourceType !== undefined) data.locationSourceType = input.locationSourceType?.trim() || null;
      if (input.locationSourceId !== undefined) data.locationSourceId = input.locationSourceId?.trim() || null;
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
        parentLocationId,
        name, slug,
        summary: input.summary === undefined ? community.summary : input.summary?.trim() || null,
        description: input.description === undefined ? community.description : input.description?.trim() || null,
        areaType: input.areaType ?? community.areaType,
        lat, lng,
        avgPricePerSqftMinor: input.avgPricePerSqftMinor === undefined ? community.avgPricePerSqftMinor?.toString() ?? null : input.avgPricePerSqftMinor,
        currency: input.currency?.trim().toUpperCase() ?? community.currency,
        locationPrecision: input.locationPrecision ?? community.locationPrecision,
        boundaryJson: input.boundaryJson === undefined ? community.boundaryJson : input.boundaryJson?.trim() || null,
        radiusMeters: input.radiusMeters ?? community.radiusMeters,
        lifestyleTags: input.lifestyleTags ?? parseArray(community.lifestyleTagsJson),
        transport: input.transport ?? parseArray(community.transportJson), schools: input.schools ?? parseArray(community.schoolsJson),
        healthcare: input.healthcare ?? parseArray(community.healthcareJson), retail: input.retail ?? parseArray(community.retailJson),
        sourceType: input.sourceType ?? community.sourceType, sourceUpdatedAt: input.sourceUpdatedAt === undefined ? community.sourceUpdatedAt : input.sourceUpdatedAt,
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

function parseArray(value: string | null): unknown[] {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

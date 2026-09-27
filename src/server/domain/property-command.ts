import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { requirePublicMedia } from "@/server/domain/media-policy";
import { canCreateCatalogResource, canManageCatalogResource } from "@/server/domain/resource-policy";
import { parseCatalogJson } from "@/server/domain/catalog-source";

export interface PropertyCommandInput {
  propertyId: string;
  expectedUpdatedAt: string;
  title?: string;
  description?: string | null;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  publicationStatus?: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
  priceAed?: number;
  availabilityStatus?: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED" | "HELD" | "WITHDRAWN";
  isFeatured?: boolean;
  coverMediaId?: string | null;
  resetSourceFields?: Array<"title" | "description" | "propertyType" | "bedrooms" | "bathrooms" | "priceAed" | "availabilityStatus">;
}

export interface NewPropertyCommandInput {
  communityId: string;
  title: string;
  slug: string;
  description?: string | null;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  lat: number;
  lng: number;
  locationPrecision: "EXACT" | "BUILDING" | "PROJECT" | "COMMUNITY_CENTROID" | "APPROXIMATE";
  listingType: "SALE" | "RENT" | "SHORT_TERM";
  rentFrequency?: "YEARLY" | "MONTHLY" | "WEEKLY" | "DAILY" | null;
  priceAed: number;
  availabilityStatus: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED" | "HELD" | "WITHDRAWN";
  coverMediaId?: string | null;
}

export async function createPropertyCommand(actor: SessionUser, input: NewPropertyCommandInput, ip: string | null) {
  if (!canCreateCatalogResource(actor)) throw new HttpError(403, "Catalog creation requires an organization-scoped staff role.", "RESOURCE_FORBIDDEN");
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  const priceMinor = Number.isFinite(input.priceAed) ? BigInt(Math.round(input.priceAed * 100)) : 0n;
  if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpError(422, "Property title and a URL-safe slug are required.", "PROPERTY_VALIDATION");
  }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90 || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new HttpError(422, "Valid coordinates are required before creating a property.", "PROPERTY_VALIDATION");
  }
  if (!Number.isFinite(input.bedrooms) || input.bedrooms < 0 || input.bedrooms > 30 || !Number.isFinite(input.bathrooms) || input.bathrooms < 0 || input.bathrooms > 30) {
    throw new HttpError(422, "Bedroom and bathroom counts must be between 0 and 30.", "PROPERTY_VALIDATION");
  }
  if (!Number.isFinite(input.priceAed) || input.priceAed <= 0 || input.priceAed > 1_000_000_000 || priceMinor <= 0n || (input.listingType === "RENT" && !input.rentFrequency)) {
    throw new HttpError(422, "A positive price and, for rentals, a rent frequency are required.", "PROPERTY_VALIDATION");
  }

  try {
    return await db.$transaction(async (tx) => {
      const community = await tx.community.findUnique({ where: { id: input.communityId }, select: { id: true } });
      if (!community) throw new HttpError(422, "Select an existing community.", "PROPERTY_RELATION_REQUIRED");
      const coverMediaId = await requirePublicMedia(tx, input.coverMediaId, ["IMAGE"]);
      const property = await tx.property.create({
        data: {
          ownerOrganizationId: actor.organizationId,
          communityId: community.id,
          title,
          slug,
          description: input.description?.trim() || null,
          propertyType: input.propertyType,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          lat: input.lat,
          lng: input.lng,
          locationPrecision: input.locationPrecision,
          locationSourceType: "MANUAL_ADMIN",
          sourceType: "INTERNAL",
          publicationStatus: "DRAFT",
          createdBy: actor.id,
          isDemoData: false,
          listings: {
            create: {
              listingType: input.listingType,
              rentFrequency: input.listingType === "RENT" ? input.rentFrequency ?? null : null,
              priceMinor,
              availabilityStatus: input.availabilityStatus,
              publishedAt: null,
              statusHistory: { create: { fromStatus: null, toStatus: input.availabilityStatus, changedBy: actor.id, reason: "Initial Admin draft creation" } },
            },
          },
        },
        include: { listings: { take: 1, orderBy: { createdAt: "desc" } } },
      });
      const listing = property.listings[0];
      if (!listing) throw new Error("Created property listing was not returned.");
      await tx.priceHistory.create({ data: { propertyId: property.id, listingId: listing.id, priceMinor, currency: "AED", sourceType: "INTERNAL" } });
      if (coverMediaId) await tx.propertyMedia.create({ data: { propertyId: property.id, mediaId: coverMediaId, isCover: true, sortOrder: 0 } });
      const after = {
        title: property.title, slug: property.slug, description: property.description, propertyType: property.propertyType,
        bedrooms: property.bedrooms, bathrooms: property.bathrooms, communityId: property.communityId,
        lat: property.lat, lng: property.lng, locationPrecision: property.locationPrecision,
        locationSourceType: property.locationSourceType, publicationStatus: property.publicationStatus,
        listingType: listing.listingType, rentFrequency: listing.rentFrequency, priceMinor: listing.priceMinor.toString(),
        availabilityStatus: listing.availabilityStatus, coverMediaId,
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "property.create", resourceType: "property", resourceId: property.id, before: null, after, ip }, tx);
      await emitEvent("property", property.id, "property.updated", { propertyId: property.id, by: actor.email }, tx);
      return { id: property.id, updatedAt: property.updatedAt.toISOString(), publicationStatus: property.publicationStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That property slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "The property changed during creation. Review and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

function publicReadiness(property: {
  title: string;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  lat: number;
  lng: number;
  community: { publicationStatus: string };
  listings: { priceMinor: bigint; availabilityStatus: string; publishedAt: Date | null; expiresAt: Date | null }[];
}): string[] {
  const issues: string[] = [];
  if (!property.title.trim()) issues.push("A title is required.");
  if (!property.propertyType.trim()) issues.push("A property type is required.");
  if (!Number.isFinite(property.bedrooms) || property.bedrooms < 0) issues.push("Bedrooms must be zero or greater.");
  if (!Number.isFinite(property.bathrooms) || property.bathrooms < 0) issues.push("Bathrooms must be zero or greater.");
  if (!Number.isFinite(property.lat) || property.lat < -90 || property.lat > 90 || !Number.isFinite(property.lng) || property.lng < -180 || property.lng > 180) {
    issues.push("Valid coordinates are required.");
  }
  if (property.community.publicationStatus !== "PUBLISHED") issues.push("The linked community must be published.");
  const now = new Date();
  const publicListing = property.listings.some((listing) =>
    listing.priceMinor > 0n &&
    listing.availabilityStatus !== "WITHDRAWN" &&
    listing.publishedAt !== null && listing.publishedAt <= now &&
    (listing.expiresAt === null || listing.expiresAt > now)
  );
  if (!publicListing) issues.push("At least one current, published, priced listing is required.");
  return issues;
}

/** Property writes are owner-organization scoped; all history, audit, and invalidation remain atomic. */
export async function updatePropertyCommand(
  actor: SessionUser,
  input: PropertyCommandInput,
  ip: string | null
) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid property version", "INVALID_VERSION");

  return db.$transaction(async (tx) => {
    const property = await tx.property.findUnique({
      where: { id: input.propertyId },
      include: {
        community: { select: { publicationStatus: true } },
        listings: { orderBy: { createdAt: "desc" } },
        media: { where: { isCover: true }, orderBy: { sortOrder: "asc" }, take: 1, select: { mediaId: true } },
      },
    });
    if (!property || property.deletedAt) throw new HttpError(404, "Property not found", "NOT_FOUND");
    if (!canManageCatalogResource(actor, property.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this property record.", "RESOURCE_FORBIDDEN");
    if (property.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new HttpError(409, "This property changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
    }

    const listing = property.listings[0];
    if (input.publicationStatus === "ARCHIVED" && property.publicationStatus !== "ARCHIVED") {
      const now = new Date();
      const activeListings = await tx.listing.count({
        where: {
          propertyId: property.id,
          publishedAt: { not: null, lte: now },
          availabilityStatus: { not: "WITHDRAWN" },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (activeListings > 0) throw new HttpError(409, "Withdraw or expire all current published listings before archiving this property.", "ACTIVE_LISTINGS_EXIST");
    }
    const resetSourceFields = new Set(input.resetSourceFields ?? []);
    if (resetSourceFields.size > 0 && property.sourceType !== "IMPORT") {
      throw new HttpError(422, "Source values are available only for imported properties.", "SOURCE_VALUE_UNAVAILABLE");
    }
    if ((input.priceAed !== undefined || input.availabilityStatus !== undefined || input.isFeatured !== undefined || resetSourceFields.has("priceAed") || resetSourceFields.has("availabilityStatus")) && !listing) {
      throw new HttpError(409, "This property has no listing to update.", "LISTING_REQUIRED");
    }
    const propertySource = parseCatalogJson(property.sourceSnapshotJson);
    const listingSource = { ...propertySource, ...parseCatalogJson(listing?.sourceSnapshotJson) };
    const nextPropertyOverrides = parseCatalogJson(property.editorOverridesJson);
    const nextListingOverrides = parseCatalogJson(listing?.editorOverridesJson);
    const sourceValue = (field: string) => listingSource[field === "availabilityStatus" ? "availability" : field];
    const restoreSourceValue = (field: string, nullable = false): unknown => {
      const value = sourceValue(field);
      if (value === undefined && !nullable) throw new HttpError(422, `No source value is available for ${field}.`, "SOURCE_VALUE_UNAVAILABLE");
      return value === undefined ? null : value;
    };
    const nextTitle = resetSourceFields.has("title") ? String(restoreSourceValue("title")) : input.title?.trim();
    const nextDescription = resetSourceFields.has("description") ? restoreSourceValue("description", true) as string | null : input.description?.trim() || (input.description === null ? null : undefined);
    const nextPropertyType = resetSourceFields.has("propertyType") ? String(restoreSourceValue("propertyType")) : input.propertyType;
    const nextBedrooms = resetSourceFields.has("bedrooms") ? Number(restoreSourceValue("bedrooms")) : input.bedrooms;
    const nextBathrooms = resetSourceFields.has("bathrooms") ? Number(restoreSourceValue("bathrooms")) : input.bathrooms;
    const nextPriceAed = resetSourceFields.has("priceAed") ? Number(restoreSourceValue("priceAed")) : input.priceAed;
    const nextAvailability = resetSourceFields.has("availabilityStatus") ? String(restoreSourceValue("availabilityStatus")) as PropertyCommandInput["availabilityStatus"] : input.availabilityStatus;
    if (resetSourceFields.has("title") && !nextTitle?.trim()) throw new HttpError(422, "The current source title is not usable.", "SOURCE_VALUE_UNAVAILABLE");
    if (resetSourceFields.has("propertyType") && !nextPropertyType?.trim()) throw new HttpError(422, "The current source property type is not usable.", "SOURCE_VALUE_UNAVAILABLE");
    if ((resetSourceFields.has("bedrooms") && (!Number.isFinite(nextBedrooms) || nextBedrooms! < 0 || nextBedrooms! > 30)) || (resetSourceFields.has("bathrooms") && (!Number.isFinite(nextBathrooms) || nextBathrooms! < 0 || nextBathrooms! > 30))) {
      throw new HttpError(422, "The current source room counts are not usable.", "SOURCE_VALUE_UNAVAILABLE");
    }
    if (resetSourceFields.has("description") && nextDescription !== null && typeof nextDescription !== "string") {
      throw new HttpError(422, "The current source description is not usable.", "SOURCE_VALUE_UNAVAILABLE");
    }
    if (resetSourceFields.has("availabilityStatus") && !["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"].includes(nextAvailability ?? "")) {
      throw new HttpError(422, "The current source availability is not usable.", "SOURCE_VALUE_UNAVAILABLE");
    }
    if (nextPriceAed !== undefined && (!Number.isFinite(nextPriceAed) || nextPriceAed <= 0 || nextPriceAed > 1_000_000_000)) {
      throw new HttpError(422, "Price must be a positive AED amount within the supported range.", "PROPERTY_VALIDATION");
    }
    const previousCoverMediaId = property.media[0]?.mediaId ?? null;
    const coverMediaId = input.coverMediaId === undefined
      ? previousCoverMediaId
      : await requirePublicMedia(tx, input.coverMediaId, ["IMAGE"]);
    const before = {
      title: property.title,
      description: property.description,
      propertyType: property.propertyType,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      publicationStatus: property.publicationStatus,
      priceMinor: listing?.priceMinor.toString() ?? null,
      availabilityStatus: listing?.availabilityStatus ?? null,
      isFeatured: listing?.isFeatured ?? null,
      coverMediaId: previousCoverMediaId,
      editorOverrides: { ...parseCatalogJson(property.editorOverridesJson), ...parseCatalogJson(listing?.editorOverridesJson) },
    };

    const propertyData: Prisma.PropertyUpdateManyMutationInput = {};
    // Touch the aggregate version even when only listing fields changed.
    propertyData.updatedAt = new Date();
    if (nextTitle !== undefined) propertyData.title = nextTitle;
    if (nextDescription !== undefined) propertyData.description = nextDescription;
    if (nextPropertyType !== undefined) propertyData.propertyType = nextPropertyType;
    if (nextBedrooms !== undefined) propertyData.bedrooms = nextBedrooms;
    if (nextBathrooms !== undefined) propertyData.bathrooms = nextBathrooms;
    if (input.publicationStatus !== undefined) propertyData.publicationStatus = input.publicationStatus;

    if (property.sourceType === "IMPORT") {
      const propertyEditableFields = ["title", "description", "propertyType", "bedrooms", "bathrooms"] as const;
      const nextValues: Record<(typeof propertyEditableFields)[number], unknown> = {
        title: nextTitle, description: nextDescription, propertyType: nextPropertyType, bedrooms: nextBedrooms, bathrooms: nextBathrooms,
      };
      for (const field of propertyEditableFields) {
        if (nextValues[field] === undefined) continue;
        const source = sourceValue(field) ?? (field === "description" ? null : undefined);
        if (JSON.stringify(nextValues[field]) === JSON.stringify(source)) delete nextPropertyOverrides[field];
        else nextPropertyOverrides[field] = nextValues[field];
      }
      propertyData.editorOverridesJson = Object.keys(nextPropertyOverrides).length ? JSON.stringify(nextPropertyOverrides) : null;

      for (const [field, value] of [["priceAed", nextPriceAed], ["availabilityStatus", nextAvailability]] as const) {
        if (value === undefined) continue;
        const source = sourceValue(field);
        if (JSON.stringify(value) === JSON.stringify(source)) delete nextListingOverrides[field];
        else nextListingOverrides[field] = value;
      }
    }

    const publishAt = input.publicationStatus === "PUBLISHED" ? new Date() : null;
    if (input.publicationStatus === "PUBLISHED") {
      const readiness = publicReadiness({
        ...property,
        title: nextTitle ?? property.title,
        propertyType: nextPropertyType ?? property.propertyType,
        bedrooms: nextBedrooms ?? property.bedrooms,
        bathrooms: nextBathrooms ?? property.bathrooms,
        listings: property.listings.map((candidate) => candidate.id === listing?.id ? {
          ...candidate,
          priceMinor: nextPriceAed === undefined ? candidate.priceMinor : BigInt(Math.round(nextPriceAed * 100)),
          availabilityStatus: nextAvailability ?? candidate.availabilityStatus,
          publishedAt: candidate.publishedAt ?? publishAt,
        } : candidate),
      });
      if (readiness.length) throw new HttpError(422, `Cannot publish: ${readiness.join(" ")}`, "PUBLICATION_VALIDATION");
    }

    const changed = await tx.property.updateMany({
      where: { id: property.id, updatedAt: expectedUpdatedAt, deletedAt: null },
      data: propertyData,
    });
    if (changed.count !== 1) throw new HttpError(409, "This property changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");

    if (input.coverMediaId !== undefined) {
      await tx.propertyMedia.updateMany({ where: { propertyId: property.id, isCover: true }, data: { isCover: false } });
      if (coverMediaId) {
        const existingMediaLink = await tx.propertyMedia.findFirst({ where: { propertyId: property.id, mediaId: coverMediaId } });
        if (existingMediaLink) await tx.propertyMedia.update({ where: { id: existingMediaLink.id }, data: { isCover: true } });
        else await tx.propertyMedia.create({ data: { propertyId: property.id, mediaId: coverMediaId, isCover: true, sortOrder: 0 } });
      }
    }

    let nextPriceMinor = listing?.priceMinor ?? null;
    if (listing && (nextPriceAed !== undefined || nextAvailability !== undefined || input.isFeatured !== undefined || (input.publicationStatus === "PUBLISHED" && listing.publishedAt === null))) {
      const data: Prisma.ListingUpdateManyMutationInput = {};
      if (nextPriceAed !== undefined) {
        nextPriceMinor = BigInt(Math.round(nextPriceAed * 100));
        data.priceMinor = nextPriceMinor;
      }
      if (nextAvailability !== undefined) data.availabilityStatus = nextAvailability;
      if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
      if (input.publicationStatus === "PUBLISHED" && listing.publishedAt === null) data.publishedAt = publishAt;
      if (property.sourceType === "IMPORT" && (nextPriceAed !== undefined || nextAvailability !== undefined)) {
        data.editorOverridesJson = Object.keys(nextListingOverrides).length ? JSON.stringify(nextListingOverrides) : null;
      }
      await tx.listing.update({ where: { id: listing.id }, data });
      if (nextPriceAed !== undefined && nextPriceMinor !== listing.priceMinor) {
        await tx.priceHistory.create({
          data: { propertyId: property.id, listingId: listing.id, priceMinor: nextPriceMinor!, currency: listing.currency, sourceType: resetSourceFields.has("priceAed") ? "IMPORT" : "INTERNAL" },
        });
      }
      if (nextAvailability !== undefined && nextAvailability !== listing.availabilityStatus) {
        await tx.listingStatusHistory.create({
          data: { listingId: listing.id, fromStatus: listing.availabilityStatus, toStatus: nextAvailability, changedBy: actor.id, reason: resetSourceFields.has("availabilityStatus") ? "Restored current source value" : "Admin update" },
        });
      }
    }

    const after = {
      title: nextTitle ?? property.title,
      description: nextDescription === undefined ? property.description : nextDescription,
      propertyType: nextPropertyType ?? property.propertyType,
      bedrooms: nextBedrooms ?? property.bedrooms,
      bathrooms: nextBathrooms ?? property.bathrooms,
      publicationStatus: input.publicationStatus ?? property.publicationStatus,
      priceMinor: nextPriceMinor?.toString() ?? null,
      availabilityStatus: nextAvailability ?? listing?.availabilityStatus ?? null,
      isFeatured: input.isFeatured ?? listing?.isFeatured ?? null,
      coverMediaId,
      editorOverrides: { ...nextPropertyOverrides, ...nextListingOverrides },
    };

    await audit({
      actorId: actor.id,
      organizationId: actor.organizationId,
      action: input.publicationStatus === "PUBLISHED" ? "property.publish" : "property.update",
      resourceType: "property",
      resourceId: property.id,
      before,
      after,
      ip,
    }, tx);
    await emitEvent("property", property.id, "property.updated", { propertyId: property.id, by: actor.email }, tx);

    const updated = await tx.property.findUniqueOrThrow({ where: { id: property.id }, select: { updatedAt: true } });
    return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createPropertyCommand, updatePropertyCommand } from "@/server/domain/property-command";
import { runImport } from "@/server/ingestion/pipeline";
import { attachGalleryMedia, removeGalleryMedia, updateGalleryMedia } from "@/server/domain/media-gallery-command";
import { deleteUnusedMedia } from "@/server/domain/media-command";

const prefix = `property-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  user: `${prefix}-user`,
  organization: `${prefix}-organization`,
  community: `${prefix}-community`,
  developer: `${prefix}-developer`,
  property: `${prefix}-property`,
  listing: `${prefix}-listing`,
  activeProperty: `${prefix}-active-property`,
  activeListing: `${prefix}-active-listing`,
  publicMedia: `${prefix}-public-media`,
  privateMedia: `${prefix}-private-media`,
  galleryMedia: `${prefix}-gallery-media`,
  importSource: `${prefix}-import-source`,
  amenity: `${prefix}-amenity`,
};
const createdSlug = `${prefix}-created`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`,
  id: ids.user,
  email: "property-command@example.invalid",
  name: "Property command integration",
  organizationId: null,
  roles: ["OWNER"],
  permissions: ["property:create", "property:update"],
  mfaVerified: true,
};

async function cleanup() {
  const runs = await db.importRun.findMany({ where: { importSourceId: ids.importSource }, select: { id: true } });
  if (runs.length) {
    await db.importRecord.deleteMany({ where: { importRunId: { in: runs.map((run) => run.id) } } });
    await db.importRun.deleteMany({ where: { id: { in: runs.map((run) => run.id) } } });
  }
  await db.importSource.deleteMany({ where: { id: ids.importSource } });
  const created = await db.property.findUnique({ where: { slug: createdSlug }, select: { id: true } });
  if (created) {
    await db.auditLog.deleteMany({ where: { resourceId: created.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: created.id } });
    await db.property.delete({ where: { id: created.id } });
  }
  await db.auditLog.deleteMany({ where: { resourceId: ids.property } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: ids.property } });
  await db.priceHistory.deleteMany({ where: { propertyId: ids.property } });
  await db.listing.deleteMany({ where: { id: ids.listing } });
  await db.property.deleteMany({ where: { id: ids.property } });
  await db.listing.deleteMany({ where: { id: ids.activeListing } });
  await db.property.deleteMany({ where: { id: ids.activeProperty } });
  await db.mediaAsset.deleteMany({ where: { id: { in: [ids.publicMedia, ids.privateMedia, ids.galleryMedia] } } });
  await db.community.deleteMany({ where: { id: ids.community } });
  await db.developer.deleteMany({ where: { id: ids.developer } });
  await db.amenity.deleteMany({ where: { id: ids.amenity } });
  await db.organization.deleteMany({ where: { id: ids.organization } });
  await db.user.deleteMany({ where: { id: ids.user } });
}

beforeAll(async () => {
  await cleanup();
  await db.organization.create({ data: { id: ids.organization, name: "Property Command Organization", slug: `${prefix}-organization` } });
  await db.user.create({ data: { id: ids.user, email: actor.email } });
  await db.importSource.create({ data: { id: ids.importSource, name: `${prefix}-feed`, sourceType: "JSON" } });
  await db.mediaAsset.createMany({ data: [
    { id: ids.publicMedia, storageKey: `${prefix}/public.jpg`, url: "/api/media/public/content", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: false },
    { id: ids.privateMedia, storageKey: `${prefix}/private.jpg`, url: "private-object://test", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: true },
    { id: ids.galleryMedia, storageKey: `${prefix}/gallery.jpg`, url: "/api/media/gallery/content", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: false },
  ] });
  await db.developer.create({ data: { id: ids.developer, name: "Command Test Developer", slug: `${prefix}-developer` } });
  await db.amenity.create({ data: { id: ids.amenity, key: `${prefix}-POOL`, name: "Test pool", category: "BUILDING" } });
  await db.community.create({
    data: {
      id: ids.community,
      name: "Command Test Community",
      slug: `${prefix}-community`,
      areaType: "WATERFRONT",
      lat: 25.08,
      lng: 55.14,
      publicationStatus: "PUBLISHED",
    },
  });
  await db.property.create({
    data: {
      id: ids.property,
      ownerOrganizationId: ids.organization,
      slug: `${prefix}-property`,
      title: "Draft command property",
      propertyType: "APARTMENT",
      bedrooms: 2,
      bathrooms: 2,
      builtUpAreaSqft: 1200,
      lat: 25.08,
      lng: 55.14,
      communityId: ids.community,
      developerId: ids.developer,
      sourceType: "IMPORT",
      sourceId: `${prefix}-external-property`,
      sourceSnapshotJson: JSON.stringify({ title: "Draft command property", description: "Original source description", propertyType: "APARTMENT", bedrooms: 2, bathrooms: 2 }),
      editorOverridesJson: null,
      locationPrecision: "EXACT",
      publicationStatus: "DRAFT",
      listings: {
        create: {
          id: ids.listing,
          priceMinor: 250_000_000n,
          sourceSnapshotJson: JSON.stringify({ listingType: "SALE", priceAed: 2_500_000, availability: "AVAILABLE", offPlan: false }),
          editorOverridesJson: null,
          publishedAt: new Date(Date.now() - 60_000),
        },
      },
    },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional property command", () => {
  test("rejects cross-organization mutation of an owned catalog row", async () => {
    const current = await db.property.findUniqueOrThrow({ where: { id: ids.property }, select: { updatedAt: true, title: true } });
    const otherOrganizationAdmin: SessionUser = { ...actor, organizationId: "another-organization", roles: ["ADMIN"] };
    await expect(updatePropertyCommand(otherOrganizationAdmin, {
      propertyId: ids.property,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      title: "Unauthorized cross-organization edit",
    }, null)).rejects.toMatchObject({ status: 403, code: "RESOURCE_FORBIDDEN" });
    expect((await db.property.findUniqueOrThrow({ where: { id: ids.property } })).title).toBe(current.title);
  });

  test("creates an internal draft with a manually entered listing, location, and public cover", async () => {
    const result = await createPropertyCommand(actor, {
      communityId: ids.community,
      title: "Created Draft Property",
      slug: createdSlug,
      description: "Integration fixture only",
      propertyType: "APARTMENT",
      bedrooms: 2,
      bathrooms: 1.5,
      lat: 25.081,
      lng: 55.141,
      locationPrecision: "BUILDING",
      listingType: "RENT",
      rentFrequency: "YEARLY",
      priceAed: 120_000,
      availabilityStatus: "AVAILABLE",
      coverMediaId: ids.publicMedia,
      developerId: ids.developer,
      subType: "Corner unit",
      builtUpAreaSqft: 1180,
      plotAreaSqft: 1400,
      furnishing: "FURNISHED",
      view: "MARINA",
      floor: 7,
      totalFloors: 20,
      handoverQuarter: "Q4 2027",
      addressLine: "Known address",
      shortDescription: "A short verified listing summary.",
      reraPermit: "RERA-TEST-001",
      titleDeedRef: "DEED-TEST-001",
      highlights: ["Waterfront", "Balcony"],
      tenure: "FREEHOLD",
      priceQualifier: "Guide price",
      serviceChargePerSqft: 14.5,
      offPlan: true,
      isExclusive: true,
      amenityIds: [ids.amenity],
    }, "127.0.0.1");
    const [property, listing, priceHistory, statusHistory, media, audit, event] = await Promise.all([
      db.property.findUniqueOrThrow({ where: { id: result.id } }),
      db.listing.findFirstOrThrow({ where: { propertyId: result.id } }),
      db.priceHistory.findFirst({ where: { propertyId: result.id } }),
      db.listingStatusHistory.findFirst({ where: { listing: { propertyId: result.id } } }),
      db.propertyMedia.findFirst({ where: { propertyId: result.id, isCover: true } }),
      db.auditLog.findFirst({ where: { resourceId: result.id, action: "property.create" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: result.id, eventType: "property.updated" } }),
    ]);
    expect(result.publicationStatus).toBe("DRAFT");
    expect(property.sourceType).toBe("INTERNAL");
    expect(property.locationSourceType).toBe("MANUAL_ADMIN");
    expect(property.locationPrecision).toBe("BUILDING");
    expect(property.isDemoData).toBe(false);
    expect(property.createdBy).toBe(ids.user);
    expect(property.developerId).toBe(ids.developer);
    expect(property.subType).toBe("Corner unit");
    expect(property.highlightsJson).toBe(JSON.stringify(["Waterfront", "Balcony"]));
    expect(listing.listingType).toBe("RENT");
    expect(listing.rentFrequency).toBe("YEARLY");
    expect(listing.priceMinor).toBe(12_000_000n);
    expect(listing.publishedAt).toBeNull();
    expect(listing.tenure).toBe("FREEHOLD");
    expect(listing.serviceChargePerSqft).toBe(14.5);
    expect((await db.propertyAmenity.findFirst({ where: { propertyId: result.id, amenityId: ids.amenity } }))?.amenityId).toBe(ids.amenity);
    expect(priceHistory?.sourceType).toBe("INTERNAL");
    expect(statusHistory?.toStatus).toBe("AVAILABLE");
    expect(statusHistory?.changedBy).toBe(ids.user);
    expect(media?.mediaId).toBe(ids.publicMedia);
    expect(audit?.action).toBe("property.create");
    expect(event?.eventType).toBe("property.updated");

    const published = await updatePropertyCommand(actor, {
      propertyId: result.id,
      expectedUpdatedAt: result.updatedAt,
      publicationStatus: "PUBLISHED",
    }, "127.0.0.1");
    expect((await db.property.findUniqueOrThrow({ where: { id: result.id } })).publicationStatus).toBe("PUBLISHED");
    expect((await db.listing.findFirstOrThrow({ where: { propertyId: result.id } })).publishedAt).not.toBeNull();
    expect(published.ok).toBe(true);
  });

  test("updates listing and property with atomic price history, audit, and outbox", async () => {
    const initial = await db.property.findUniqueOrThrow({ where: { id: ids.property }, select: { updatedAt: true } });
    const result = await updatePropertyCommand(actor, {
      propertyId: ids.property,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      title: "Verified command property",
      priceAed: 2_600_000,
      coverMediaId: ids.publicMedia,
      shortDescription: "Editorial summary",
      builtUpAreaSqft: 1325,
      furnishing: "SEMI_FURNISHED",
      highlights: ["Updated fact"],
      listingType: "RENT",
      rentFrequency: "MONTHLY",
      tenure: "LEASEHOLD",
      offPlan: true,
      isExclusive: true,
      amenityIds: [ids.amenity],
    }, "127.0.0.1");

    expect(result.ok).toBe(true);
    const [property, listing, history, audit, event] = await Promise.all([
      db.property.findUniqueOrThrow({ where: { id: ids.property } }),
      db.listing.findUniqueOrThrow({ where: { id: ids.listing } }),
      db.priceHistory.findMany({ where: { propertyId: ids.property } }),
      db.auditLog.findFirst({ where: { resourceId: ids.property }, orderBy: { createdAt: "desc" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: ids.property }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(property.title).toBe("Verified command property");
    expect(property.shortDescription).toBe("Editorial summary");
    expect(property.builtUpAreaSqft).toBe(1325);
    expect((await db.propertyMedia.findFirst({ where: { propertyId: ids.property, isCover: true } }))?.mediaId).toBe(ids.publicMedia);
    expect(property.updatedAt.toISOString()).toBe(result.updatedAt);
    expect(listing.priceMinor).toBe(260_000_000n);
    expect(listing.listingType).toBe("RENT");
    expect(listing.rentFrequency).toBe("MONTHLY");
    expect(listing.tenure).toBe("LEASEHOLD");
    expect(history).toHaveLength(1);
    expect(audit?.action).toBe("property.update");
    expect(event?.eventType).toBe("property.updated");

    const attached = await attachGalleryMedia(actor, "property", ids.property, [ids.publicMedia, ids.galleryMedia], "127.0.0.1");
    expect(attached.mediaIds).toEqual([ids.publicMedia, ids.galleryMedia]);
    await expect(deleteUnusedMedia(actor, ids.publicMedia, null)).rejects.toMatchObject({ status: 409, code: "MEDIA_IN_USE" });
    const reordered = await updateGalleryMedia(actor, "property", ids.property, [ids.galleryMedia, ids.publicMedia], ids.publicMedia, null);
    expect(reordered.coverMediaId).toBe(ids.publicMedia);
    expect((await db.propertyMedia.findFirstOrThrow({ where: { propertyId: ids.property, mediaId: ids.galleryMedia } })).sortOrder).toBe(0);
    const removed = await removeGalleryMedia(actor, "property", ids.property, [ids.galleryMedia], null);
    expect(removed.mediaIds).toEqual([ids.publicMedia]);

    await expect(updatePropertyCommand(actor, {
      propertyId: ids.property,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      title: "Stale write",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect((await db.property.findUniqueOrThrow({ where: { id: ids.property } })).title).toBe("Verified command property");
  });

  test("refuses to archive while a current published listing remains active", async () => {
    await db.property.create({ data: {
      id: ids.activeProperty, communityId: ids.community, slug: `${prefix}-active-property`, title: "Active listing property",
      lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED",
      listings: { create: { id: ids.activeListing, priceMinor: 125_000_000n, publishedAt: new Date(Date.now() - 60_000), availabilityStatus: "AVAILABLE" } },
    } });
    const current = await db.property.findUniqueOrThrow({ where: { id: ids.activeProperty }, select: { updatedAt: true, publicationStatus: true } });
    await expect(updatePropertyCommand(actor, {
      propertyId: ids.activeProperty, expectedUpdatedAt: current.updatedAt.toISOString(), publicationStatus: "ARCHIVED",
    }, null)).rejects.toMatchObject({ status: 409, code: "ACTIVE_LISTINGS_EXIST" });
    const unchanged = await db.property.findUniqueOrThrow({ where: { id: ids.activeProperty } });
    expect(unchanged.publicationStatus).toBe(current.publicationStatus);
    expect(unchanged.updatedAt).toEqual(current.updatedAt);
  });

  test("refuses publication without writing any partial state", async () => {
    const current = await db.property.findUniqueOrThrow({ where: { id: ids.property }, select: { updatedAt: true } });
    await db.community.update({ where: { id: ids.community }, data: { publicationStatus: "DRAFT" } });
    const before = await db.property.findUniqueOrThrow({ where: { id: ids.property } });
    await expect(updatePropertyCommand(actor, {
      propertyId: ids.property,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      publicationStatus: "PUBLISHED",
    }, null)).rejects.toMatchObject({ status: 422, code: "PUBLICATION_VALIDATION" });
    expect((await db.property.findUniqueOrThrow({ where: { id: ids.property } })).updatedAt).toEqual(before.updatedAt);

    await db.community.update({ where: { id: ids.community }, data: { publicationStatus: "PUBLISHED" } });
    await expect(updatePropertyCommand(actor, {
      propertyId: ids.property,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      publicationStatus: "PUBLISHED",
      availabilityStatus: "WITHDRAWN",
    }, null)).rejects.toMatchObject({ status: 422, code: "PUBLICATION_VALIDATION" });
    expect((await db.property.findUniqueOrThrow({ where: { id: ids.property } })).publicationStatus).toBe("DRAFT");
    const mediaVersion = await db.property.findUniqueOrThrow({ where: { id: ids.property }, select: { updatedAt: true } });
    await expect(updatePropertyCommand(actor, {
      propertyId: ids.property, expectedUpdatedAt: mediaVersion.updatedAt.toISOString(), coverMediaId: ids.privateMedia,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
    expect((await db.propertyMedia.findFirst({ where: { propertyId: ids.property, isCover: true } }))?.mediaId).toBe(ids.publicMedia);
  });

  test("refreshes source snapshots without clobbering edits, then restores selected source values", async () => {
    const summary = await runImport({
      sourceId: ids.importSource,
      triggeredBy: actor.email,
      records: [{
        externalId: `${prefix}-external-property`, title: "Provider refreshed title", community: "Command Test Community",
        propertyType: "VILLA", listingType: "SALE", bedrooms: 3, bathrooms: 2.5,
        priceAed: 2_900_000, offPlan: true, availability: "RESERVED", description: "Refreshed source description",
      }],
    });
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);

    const [refreshedProperty, refreshedListing] = await Promise.all([
      db.property.findUniqueOrThrow({ where: { id: ids.property } }),
      db.listing.findUniqueOrThrow({ where: { id: ids.listing } }),
    ]);
    expect(refreshedProperty.title).toBe("Verified command property");
    expect(refreshedProperty.propertyType).toBe("VILLA");
    expect(refreshedProperty.bedrooms).toBe(3);
    expect(refreshedProperty.description).toBe("Refreshed source description");
    expect(JSON.parse(refreshedProperty.sourceSnapshotJson ?? "{}").title).toBe("Provider refreshed title");
    expect(refreshedListing.priceMinor).toBe(260_000_000n);
    expect(refreshedListing.availabilityStatus).toBe("RESERVED");
    expect(JSON.parse(refreshedListing.sourceSnapshotJson ?? "{}").priceAed).toBe(2_900_000);

    await updatePropertyCommand(actor, {
      propertyId: ids.property,
      expectedUpdatedAt: refreshedProperty.updatedAt.toISOString(),
      resetSourceFields: ["title", "priceAed"],
    }, null);
    const [restoredProperty, restoredListing] = await Promise.all([
      db.property.findUniqueOrThrow({ where: { id: ids.property } }),
      db.listing.findUniqueOrThrow({ where: { id: ids.listing } }),
    ]);
    expect(restoredProperty.title).toBe("Provider refreshed title");
    // Restoring selected source-backed values must keep unrelated editorial
    // overrides that have no corresponding source value to restore from.
    expect(JSON.parse(restoredProperty.editorOverridesJson ?? "{}")).toMatchObject({
      builtUpAreaSqft: 1325,
      furnishing: "SEMI_FURNISHED",
      shortDescription: "Editorial summary",
      highlights: ["Updated fact"],
    });
    expect(restoredListing.priceMinor).toBe(290_000_000n);
    expect(JSON.parse(restoredListing.editorOverridesJson ?? "{}")).toMatchObject({
      tenure: "LEASEHOLD",
      offPlan: true,
      isExclusive: true,
    });
    expect(JSON.parse(restoredListing.editorOverridesJson ?? "{}")).not.toHaveProperty("priceAed");
  });
});

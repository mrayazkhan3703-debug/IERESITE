import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createPropertyCommand, updatePropertyCommand } from "@/server/domain/property-command";
import { createProjectCommand, updateProjectCommand } from "@/server/domain/project-command";
import { deleteUnusedMedia, updateMediaMetadata } from "@/server/domain/media-command";
import { getPropertyDetail, getProjectDetailV2 } from "@/server/domain/read-models";
import { issueReportDownloadGrant, validReportDownloadGrant } from "@/server/media/download-grant";

const prefix = "inline-media-" + crypto.randomUUID();
const userId = prefix + "-user", communityId = prefix + "-community", developerId = prefix + "-developer";
const assets = { image: prefix + "-image", replacement: prefix + "-replacement", video: prefix + "-video", pdf: prefix + "-pdf", private: prefix + "-private" };
const entityIds: string[] = [];
const actor: SessionUser = { sessionId: prefix, id: userId, email: prefix + "@example.invalid", name: "Synthetic media verifier", organizationId: null, roles: ["OWNER"], permissions: ["property:create", "property:update", "project:create", "project:update", "media:update", "media:delete"], mfaVerified: true };

beforeAll(async () => {
  await db.user.create({ data: { id: userId, email: actor.email } });
  await db.developer.create({ data: { id: developerId, slug: developerId, name: "Synthetic media test developer" } });
  await db.community.create({ data: { id: communityId, slug: communityId, name: "Synthetic media test community", areaType: "RESIDENTIAL", publicationStatus: "PUBLISHED", lat: 25, lng: 55 } });
  await db.mediaAsset.createMany({ data: Object.entries(assets).map(([kind, id]) => ({
    id, storageKey: "public/media/" + id, url: "/api/media/" + id + "/content",
    kind: kind === "video" ? "VIDEO" : ["pdf", "private"].includes(kind) ? "DOCUMENT" : "IMAGE",
    mimeType: kind === "video" ? "video/mp4" : ["pdf", "private"].includes(kind) ? "application/pdf" : "image/jpeg",
    sizeBytes: 100, isPrivate: kind === "private", altText: "Asset default",
  })) });
});
afterAll(async () => {
  await db.mediaDownloadGrant.deleteMany({ where: { mediaId: { in: Object.values(assets) } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: userId }, { resourceId: { in: entityIds } }] } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...entityIds, ...Object.values(assets)] } } });
  await db.property.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.project.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.community.delete({ where: { id: communityId } });
  await db.developer.delete({ where: { id: developerId } });
  await db.mediaAsset.updateMany({ where: { id: { in: Object.values(assets) } }, data: { posterMediaId: null } });
  await db.mediaAsset.deleteMany({ where: { id: { in: Object.values(assets) } } });
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

describe("transactional inline entity attachments", () => {
  test("create, reload, replace, order and detach property media without changing shared assets", async () => {
    const created = await createPropertyCommand(actor, {
      communityId, title: "Synthetic attachment verification", slug: prefix + "-property", propertyType: "APARTMENT",
      bedrooms: 2, bathrooms: 2, lat: 25, lng: 55, locationPrecision: "BUILDING", listingType: "SALE", priceAed: 100, availabilityStatus: "AVAILABLE",
      gallery: [{ mediaId: assets.image, isCover: true, caption: "Entity caption", altText: "Entity alt" }, { mediaId: assets.video }],
      floorPlans: [{ mediaId: assets.pdf, bedrooms: 2, label: "Plan", areaSqft: 500 }],
      documents: [{ mediaId: assets.pdf, docType: "BROCHURE", label: "Brochure", gated: false }],
    }, null);
    entityIds.push(created.id);
    const detail = await getPropertyDetail(prefix + "-property", { previewScope: { id: created.id } });
    expect(detail?.media[0]).toMatchObject({ id: assets.image, altText: "Entity alt", caption: "Entity caption" });
    expect(detail?.media[1]?.kind).toBe("VIDEO");
    expect(detail?.floorPlans[0]?.label).toBe("Plan");
    const updated = await updatePropertyCommand(actor, { propertyId: created.id, expectedUpdatedAt: created.updatedAt,
      gallery: [{ mediaId: assets.video }, { mediaId: assets.replacement, isCover: true, caption: "Replacement caption" }], floorPlans: [], documents: [],
    }, null);
    expect(updated.ok).toBe(true);
    const rows = await db.propertyMedia.findMany({ where: { propertyId: created.id }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((row) => row.mediaId)).toEqual([assets.video, assets.replacement]);
    expect(rows[1].isCover).toBe(true);
    expect(await db.mediaAsset.count({ where: { id: { in: Object.values(assets) } } })).toBe(5);
    expect(await db.propertyFloorPlan.count({ where: { propertyId: created.id } })).toBe(0);
    await expect(updatePropertyCommand(actor, { propertyId: created.id, expectedUpdatedAt: created.updatedAt, gallery: [] }, null)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  test("new project attachments satisfy publication checks atomically and rollback invalid edits", async () => {
    const created = await createProjectCommand(actor, {
      developerId, communityId, name: "Synthetic project attachment verification", slug: prefix + "-project", summary: "Synthetic test summary", description: "Synthetic integration only.",
      projectType: "RESIDENTIAL", status: "OFF_PLAN", lat: 25, lng: 55, locationPrecision: "PROJECT",
      gallery: [], progressGallery: [{ mediaId: assets.video }], documents: [{ mediaId: assets.pdf, docType: "BROCHURE", gated: false }],
    }, null);
    entityIds.push(created.id);
    await expect(updateProjectCommand(actor, { projectId: created.id, expectedUpdatedAt: created.updatedAt, name: "Must rollback", gallery: [{ mediaId: assets.private }] }, null)).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
    expect((await db.project.findUniqueOrThrow({ where: { id: created.id } })).name).toBe("Synthetic project attachment verification");
    const saved = await updateProjectCommand(actor, { projectId: created.id, expectedUpdatedAt: created.updatedAt, publicationStatus: "PUBLISHED",
      gallery: [{ mediaId: assets.image, isCover: true, altText: "Project override" }, { mediaId: assets.video }],
    }, null);
    expect(saved.ok).toBe(true);
    const detail = await getProjectDetailV2(prefix + "-project");
    expect(detail?.media.find((asset) => asset.id === assets.image)?.altText).toBe("Project override");
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: assets.image } })).altText).toBe("Asset default");
    await expect(deleteUnusedMedia(actor, assets.image, null)).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
  });

  test("poster updates require an image, reject stale metadata and protect shared poster deletion", async () => {
    const video = await db.mediaAsset.findUniqueOrThrow({ where: { id: assets.video } });
    await updateMediaMetadata(actor, { mediaAssetId: video.id, expectedUpdatedAt: video.updatedAt.toISOString(), posterMediaId: assets.image }, null);
    await expect(updateMediaMetadata(actor, { mediaAssetId: video.id, expectedUpdatedAt: video.updatedAt.toISOString(), posterMediaId: assets.pdf }, null)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const current = await db.mediaAsset.findUniqueOrThrow({ where: { id: assets.video } });
    await expect(updateMediaMetadata(actor, { mediaAssetId: video.id, expectedUpdatedAt: current.updatedAt.toISOString(), posterMediaId: assets.pdf }, null)).rejects.toMatchObject({ code: "INVALID_POSTER" });
    await expect(deleteUnusedMedia(actor, assets.image, null)).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
    const grant = await issueReportDownloadGrant(assets.pdf, "nonexistent-report");
    expect(await validReportDownloadGrant(new URL(grant!, "http://localhost").searchParams.get("grant"), assets.pdf)).toBe(false);
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: assets.video } })).altText).toBe("Asset default");
  });

  test("protected documents cannot be downloaded by a guessed public media id", async () => {
    const property = await db.property.findFirstOrThrow({ where: { slug: prefix + "-property" } });
    await db.propertyDocument.create({ data: { propertyId: property.id, mediaId: assets.pdf, docType: "TITLE_DEED", gated: true } });
    const response = await fetch((process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000") + "/api/media/" + assets.pdf + "/content");
    expect([401, 403]).toContain(response.status);
  });
});

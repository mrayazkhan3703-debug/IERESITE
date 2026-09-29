import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createCommunityCommand, updateCommunityCommand } from "@/server/domain/community-command";

const prefix = `community-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = { user: `${prefix}-user`, developer: `${prefix}-developer`, community: `${prefix}-community`, project: `${prefix}-project`, property: `${prefix}-property`, archiveDeveloper: `${prefix}-archive-developer`, archiveCommunity: `${prefix}-archive-community`, archiveProject: `${prefix}-archive-project`, archiveProperty: `${prefix}-archive-property`, publicMedia: `${prefix}-public-media`, privateMedia: `${prefix}-private-media` };
const beforeSlug = `${prefix}-old`;
const afterSlug = `${prefix}-new`;
const createdSlug = `${prefix}-created`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: ids.user, email: "community-command@example.invalid", name: "Community command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["community:create", "community:update"], mfaVerified: true,
};

async function cleanup() {
  const created = await db.community.findUnique({ where: { slug: createdSlug }, select: { id: true } });
  if (created) {
    await db.auditLog.deleteMany({ where: { resourceId: created.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: created.id } });
    await db.community.delete({ where: { id: created.id } });
  }
  await db.auditLog.deleteMany({ where: { resourceId: ids.community } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: ids.community } });
  await db.redirect.deleteMany({ where: { fromPath: `/communities/${beforeSlug}` } });
  await db.project.deleteMany({ where: { id: ids.project } });
  await db.property.deleteMany({ where: { id: ids.property } });
  await db.property.deleteMany({ where: { id: ids.archiveProperty } });
  await db.project.deleteMany({ where: { id: ids.archiveProject } });
  await db.community.deleteMany({ where: { id: ids.community } });
  await db.community.deleteMany({ where: { id: ids.archiveCommunity } });
  await db.developer.deleteMany({ where: { id: ids.developer } });
  await db.developer.deleteMany({ where: { id: ids.archiveDeveloper } });
  await db.mediaAsset.deleteMany({ where: { id: { in: [ids.publicMedia, ids.privateMedia] } } });
  await db.user.deleteMany({ where: { id: ids.user } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: ids.user, email: actor.email } });
  await db.mediaAsset.createMany({ data: [
    { id: ids.publicMedia, storageKey: `${prefix}/public.jpg`, url: "/api/media/public/content", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: false },
    { id: ids.privateMedia, storageKey: `${prefix}/private.jpg`, url: "private-object://test", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: true },
  ] });
  await db.community.create({
    data: { id: ids.community, name: "Draft Command Community", slug: beforeSlug, summary: "Community integration fixture", description: "Test-only details for publishing a valid community fixture.", areaType: "RESIDENTIAL", lat: 25.08, lng: 55.14, locationPrecision: "COMMUNITY_CENTROID", imageMediaId: ids.publicMedia, publicationStatus: "DRAFT" },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional community command", () => {
  test("creates an internal draft with manual location provenance and validated public media", async () => {
    const result = await createCommunityCommand(actor, {
      name: "Created Draft Community",
      slug: createdSlug,
      summary: "Integration fixture only",
      areaType: "RESIDENTIAL",
      lat: 25.1,
      lng: 55.2,
      locationPrecision: "COMMUNITY_CENTROID",
      imageMediaId: ids.publicMedia,
    }, "127.0.0.1");
    const [community, audit, event] = await Promise.all([
      db.community.findUniqueOrThrow({ where: { id: result.id } }),
      db.auditLog.findFirst({ where: { resourceId: result.id } }),
      db.outboxEvent.findFirst({ where: { aggregateId: result.id } }),
    ]);
    expect(result.publicationStatus).toBe("DRAFT");
    expect(community.sourceType).toBe("INTERNAL");
    expect(community.locationSourceType).toBe("MANUAL_ADMIN");
    expect(community.locationPrecision).toBe("COMMUNITY_CENTROID");
    expect(community.imageMediaId).toBe(ids.publicMedia);
    expect(community.isDemoData).toBe(false);
    expect(audit?.action).toBe("community.create");
    expect(event?.eventType).toBe("community.updated");
  });

  test("publishes with slug redirect, audit, and a community outbox event", async () => {
    const initial = await db.community.findUniqueOrThrow({ where: { id: ids.community }, select: { updatedAt: true } });
    const result = await updateCommunityCommand(actor, {
      communityId: ids.community,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      name: "Public Command Community",
      slug: afterSlug,
      publicationStatus: "PUBLISHED",
      imageMediaId: ids.publicMedia,
    }, "127.0.0.1");
    expect(result.ok).toBe(true);
    const [community, redirect, audit, event] = await Promise.all([
      db.community.findUniqueOrThrow({ where: { id: ids.community } }),
      db.redirect.findUnique({ where: { fromPath: `/communities/${beforeSlug}` } }),
      db.auditLog.findFirst({ where: { resourceId: ids.community }, orderBy: { createdAt: "desc" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: ids.community }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(community.publicationStatus).toBe("PUBLISHED");
    expect(community.imageMediaId).toBe(ids.publicMedia);
    expect(redirect?.toPath).toBe(`/communities/${afterSlug}`);
    expect(audit?.action).toBe("community.publish");
    expect(event?.eventType).toBe("community.updated");
    await expect(updateCommunityCommand(actor, {
      communityId: ids.community,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      name: "Stale community save",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  test("refuses private cover media without changing the community", async () => {
    const current = await db.community.findUniqueOrThrow({ where: { id: ids.community }, select: { updatedAt: true, imageMediaId: true } });
    await expect(updateCommunityCommand(actor, {
      communityId: ids.community, expectedUpdatedAt: current.updatedAt.toISOString(), imageMediaId: ids.privateMedia,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
    expect((await db.community.findUniqueOrThrow({ where: { id: ids.community } })).imageMediaId).toBe(current.imageMediaId);
  });

  test("refuses to hide a community with published project or property usage", async () => {
    await db.developer.create({ data: { id: ids.archiveDeveloper, name: "Community Archive Developer", slug: `${prefix}-archive-developer` } });
    await db.community.create({ data: { id: ids.archiveCommunity, name: "Community Archive Target", slug: `${prefix}-archive-community`, areaType: "RESIDENTIAL", lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED" } });
    await db.project.create({
      data: {
        id: ids.archiveProject, developerId: ids.archiveDeveloper, communityId: ids.archiveCommunity, name: "Public Child Project", slug: `${prefix}-archive-project`,
        lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED",
      },
    });
    const current = await db.community.findUniqueOrThrow({ where: { id: ids.archiveCommunity }, select: { updatedAt: true } });
    await expect(updateCommunityCommand(actor, {
      communityId: ids.archiveCommunity,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      publicationStatus: "DRAFT",
    }, null)).rejects.toMatchObject({ status: 409, code: "PUBLISHED_PROJECTS_EXIST" });
    expect((await db.community.findUniqueOrThrow({ where: { id: ids.archiveCommunity } })).publicationStatus).toBe("PUBLISHED");
    await db.project.update({ where: { id: ids.archiveProject }, data: { publicationStatus: "DRAFT" } });
    await db.property.create({ data: {
      id: ids.archiveProperty, communityId: ids.archiveCommunity, slug: `${prefix}-archive-property`, title: "Published community property",
      lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED",
    } });
    const currentPropertyCheck = await db.community.findUniqueOrThrow({ where: { id: ids.archiveCommunity }, select: { updatedAt: true } });
    await expect(updateCommunityCommand(actor, {
      communityId: ids.archiveCommunity, expectedUpdatedAt: currentPropertyCheck.updatedAt.toISOString(), publicationStatus: "ARCHIVED",
    }, null)).rejects.toMatchObject({ status: 409, code: "PUBLISHED_PROPERTIES_EXIST" });
    expect((await db.community.findUniqueOrThrow({ where: { id: ids.archiveCommunity } })).publicationStatus).toBe("PUBLISHED");
  });
});

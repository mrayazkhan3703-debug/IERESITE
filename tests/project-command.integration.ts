import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createProjectCommand, updateProjectCommand } from "@/server/domain/project-command";
import { getProjectDetailV2 } from "@/server/domain/read-models";

const prefix = `project-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = { user: `${prefix}-user`, developer: `${prefix}-developer`, community: `${prefix}-community`, project: `${prefix}-project`, childProperty: `${prefix}-child-property`, archiveDeveloper: `${prefix}-archive-developer`, archiveCommunity: `${prefix}-archive-community`, archiveProject: `${prefix}-archive-project`, childPropertyToArchive: `${prefix}-child-property-to-archive`, publicMedia: `${prefix}-public-media`, privateMedia: `${prefix}-private-media` };
const beforeSlug = `${prefix}-old`;
const afterSlug = `${prefix}-new`;
const createdSlug = `${prefix}-created`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: ids.user, email: "project-command@example.invalid", name: "Project command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["project:create", "project:update"], mfaVerified: true,
};

async function cleanup() {
  const created = await db.project.findUnique({ where: { slug: createdSlug }, select: { id: true } });
  if (created) {
    await db.auditLog.deleteMany({ where: { resourceId: created.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: created.id } });
    await db.projectStatusHistory.deleteMany({ where: { projectId: created.id } });
    await db.project.delete({ where: { id: created.id } });
  }
  await db.auditLog.deleteMany({ where: { resourceId: ids.project } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: ids.project } });
  await db.projectStatusHistory.deleteMany({ where: { projectId: ids.project } });
  await db.property.deleteMany({ where: { id: ids.childProperty } });
  await db.redirect.deleteMany({ where: { fromPath: `/projects/${beforeSlug}` } });
  await db.property.deleteMany({ where: { id: ids.childPropertyToArchive } });
  await db.project.deleteMany({ where: { id: ids.archiveProject } });
  await db.community.deleteMany({ where: { id: ids.archiveCommunity } });
  await db.developer.deleteMany({ where: { id: ids.archiveDeveloper } });
  await db.project.deleteMany({ where: { id: ids.project } });
  await db.community.deleteMany({ where: { id: ids.community } });
  await db.developer.deleteMany({ where: { id: ids.developer } });
  await db.mediaAsset.deleteMany({ where: { id: { in: [ids.publicMedia, ids.privateMedia] } } });
  await db.user.deleteMany({ where: { id: ids.user } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: ids.user, email: actor.email } });
  await db.mediaAsset.createMany({ data: [
    { id: ids.publicMedia, storageKey: `${prefix}/public.pdf`, url: "/api/media/public/content", mimeType: "application/pdf", sizeBytes: 256, kind: "DOCUMENT", isPrivate: false },
    { id: ids.privateMedia, storageKey: `${prefix}/private.pdf`, url: "private-object://test", mimeType: "application/pdf", sizeBytes: 256, kind: "DOCUMENT", isPrivate: true },
  ] });
  await db.developer.create({ data: { id: ids.developer, name: "Project Command Developer", slug: `${prefix}-developer` } });
  await db.community.create({
    data: { id: ids.community, name: "Project Command Community", slug: `${prefix}-community`, areaType: "RESIDENTIAL", lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED" },
  });
  await db.project.create({
    data: {
      id: ids.project, developerId: ids.developer, communityId: ids.community, name: "Command Draft", slug: beforeSlug,
      lat: 25.08, lng: 55.14, publicationStatus: "DRAFT",
    },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional project command", () => {
  test("creates an internal draft with manual location provenance and existing relations", async () => {
    const result = await createProjectCommand(actor, {
      developerId: ids.developer,
      communityId: ids.community,
      name: "Created Draft Project",
      slug: createdSlug,
      summary: "Integration fixture only",
      projectType: "RESIDENTIAL",
      status: "OFF_PLAN",
      lat: 25.09,
      lng: 55.15,
      locationPrecision: "PROJECT",
      brochureMediaId: ids.publicMedia,
    }, "127.0.0.1");
    const [project, history, audit, event] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: result.id } }),
      db.projectStatusHistory.findFirst({ where: { projectId: result.id } }),
      db.auditLog.findFirst({ where: { resourceId: result.id } }),
      db.outboxEvent.findFirst({ where: { aggregateId: result.id } }),
    ]);
    expect(result.publicationStatus).toBe("DRAFT");
    expect(project.developerId).toBe(ids.developer);
    expect(project.communityId).toBe(ids.community);
    expect(project.sourceType).toBe("INTERNAL");
    expect(project.locationSourceType).toBe("MANUAL_ADMIN");
    expect(project.locationPrecision).toBe("PROJECT");
    expect(project.brochureMediaId).toBe(ids.publicMedia);
    expect(project.isDemoData).toBe(false);
    expect(history?.toStatus).toBe("OFF_PLAN");
    expect(history?.changedBy).toBe(ids.user);
    expect(audit?.action).toBe("project.create");
    expect(event?.eventType).toBe("project.updated");
  });

  test("publishes with slug redirect, status history, audit, and outbox atomically", async () => {
    const initial = await db.project.findUniqueOrThrow({ where: { id: ids.project }, select: { updatedAt: true } });
    const result = await updateProjectCommand(actor, {
      projectId: ids.project,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      name: "Command Published Project",
      slug: afterSlug,
      status: "UNDER_CONSTRUCTION",
      publicationStatus: "PUBLISHED",
      brochureMediaId: ids.publicMedia,
    }, "127.0.0.1");
    expect(result.ok).toBe(true);

    const [project, redirect, history, audit, event] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: ids.project } }),
      db.redirect.findUnique({ where: { fromPath: `/projects/${beforeSlug}` } }),
      db.projectStatusHistory.findMany({ where: { projectId: ids.project } }),
      db.auditLog.findFirst({ where: { resourceId: ids.project }, orderBy: { createdAt: "desc" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: ids.project }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(project.publicationStatus).toBe("PUBLISHED");
    expect(project.brochureMediaId).toBe(ids.publicMedia);
    expect((await getProjectDetailV2(afterSlug))?.brochure?.id).toBe(ids.publicMedia);
    expect(redirect?.toPath).toBe(`/projects/${afterSlug}`);
    expect(history[0]?.toStatus).toBe("UNDER_CONSTRUCTION");
    expect(audit?.action).toBe("project.publish");
    expect(event?.eventType).toBe("project.updated");
    await expect(updateProjectCommand(actor, {
      projectId: ids.project,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      name: "Stale project save",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  test("rejects publication when its community is not public", async () => {
    await db.community.update({ where: { id: ids.community }, data: { publicationStatus: "DRAFT" } });
    const current = await db.project.findUniqueOrThrow({ where: { id: ids.project }, select: { updatedAt: true, publicationStatus: true } });
    await expect(updateProjectCommand(actor, {
      projectId: ids.project,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      publicationStatus: "PUBLISHED",
    }, null)).rejects.toMatchObject({ status: 422, code: "PUBLICATION_VALIDATION" });
    expect((await db.project.findUniqueOrThrow({ where: { id: ids.project } })).updatedAt).toEqual(current.updatedAt);
    await expect(updateProjectCommand(actor, {
      projectId: ids.project, expectedUpdatedAt: current.updatedAt.toISOString(), brochureMediaId: ids.privateMedia,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
  });

  test("refuses to archive while published property usages remain", async () => {
    await db.developer.create({ data: { id: ids.archiveDeveloper, name: "Archive Test Developer", slug: `${prefix}-archive-developer` } });
    await db.community.create({ data: { id: ids.archiveCommunity, name: "Archive Test Community", slug: `${prefix}-archive-community`, areaType: "RESIDENTIAL", lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED" } });
    await db.project.create({ data: {
      id: ids.archiveProject, developerId: ids.archiveDeveloper, communityId: ids.archiveCommunity, name: "Archive Test Project",
      slug: `${prefix}-archive-project`, lat: 25.08, lng: 55.14, publicationStatus: "DRAFT",
    } });
    await db.property.create({ data: {
      id: ids.childPropertyToArchive, projectId: ids.archiveProject, communityId: ids.archiveCommunity, slug: `${prefix}-child-property-to-archive`,
      title: "Published child property", lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED",
    } });
    const current = await db.project.findUniqueOrThrow({ where: { id: ids.archiveProject }, select: { updatedAt: true } });
    await expect(updateProjectCommand(actor, {
      projectId: ids.archiveProject, expectedUpdatedAt: current.updatedAt.toISOString(), publicationStatus: "ARCHIVED",
    }, null)).rejects.toMatchObject({ status: 409, code: "ACTIVE_PROJECT_USAGES_EXIST" });
    expect((await db.project.findUniqueOrThrow({ where: { id: ids.archiveProject } })).publicationStatus).toBe("DRAFT");
  });
});

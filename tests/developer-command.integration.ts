import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { PUBLIC_DEVELOPER_WHERE } from "@/server/domain/visibility";
import type { SessionUser } from "@/server/auth";
import { createDeveloperCommand, updateDeveloperCommand } from "@/server/domain/developer-command";

const prefix = `developer-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const developerId = `${prefix}-developer`;
const publicMediaId = `${prefix}-public-media`;
const privateMediaId = `${prefix}-private-media`;
const beforeSlug = `${prefix}-old`;
const afterSlug = `${prefix}-new`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "developer-command@example.invalid", name: "Developer command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["developer:update", "developer:create"], mfaVerified: true,
};

async function cleanup() {
  const developers = await db.developer.findMany({ where: { OR: [{ id: developerId }, { slug: { startsWith: prefix } }] }, select: { id: true } });
  const ids = developers.map((developer) => developer.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.developer.deleteMany({ where: { id: { in: ids } } });
  }
  await db.mediaAsset.deleteMany({ where: { id: { in: [publicMediaId, privateMediaId] } } });
  await db.redirect.deleteMany({ where: { OR: [{ fromPath: { contains: prefix } }, { toPath: { contains: prefix } }] } });
  await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
  await db.mediaAsset.createMany({ data: [
    { id: publicMediaId, storageKey: `${prefix}/public.jpg`, url: "/api/media/public/content", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: false },
    { id: privateMediaId, storageKey: `${prefix}/private.jpg`, url: "private-object://test", mimeType: "image/jpeg", sizeBytes: 256, kind: "IMAGE", isPrivate: true },
  ] });
  await db.developer.create({ data: { id: developerId, name: "Unverified Test Developer", slug: beforeSlug } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional developer command", () => {
  test("edits facts with redirect, audit, outbox, and no implicit verification", async () => {
    const initial = await db.developer.findUniqueOrThrow({ where: { id: developerId }, select: { updatedAt: true } });
    const result = await updateDeveloperCommand(actor, {
      developerId,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      name: "Edited Test Developer",
      slug: afterSlug,
      websiteUrl: "https://example.invalid",
      foundedYear: 2001,
      logoMediaId: publicMediaId,
    }, "127.0.0.1");
    expect(result.ok).toBe(true);

    const [developer, redirect, audit, event] = await Promise.all([
      db.developer.findUniqueOrThrow({ where: { id: developerId } }),
      db.redirect.findUnique({ where: { fromPath: `/developers/${beforeSlug}` } }),
      db.auditLog.findFirst({ where: { resourceId: developerId }, orderBy: { createdAt: "desc" } }),
      db.outboxEvent.findFirst({ where: { aggregateId: developerId }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(developer.name).toBe("Edited Test Developer");
    expect(developer.verificationStatus).toBe("UNVERIFIED");
    expect(developer.lastVerifiedAt).toBeNull();
    expect(developer.logoMediaId).toBe(publicMediaId);
    expect(redirect?.toPath).toBe(`/developers/${afterSlug}`);
    expect(audit?.action).toBe("developer.update");
    expect(event?.eventType).toBe("developer.updated");
    await expect(updateDeveloperCommand(actor, {
      developerId, expectedUpdatedAt: initial.updatedAt.toISOString(), name: "Stale save",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  test("refuses unsafe website protocols", async () => {
    const current = await db.developer.findUniqueOrThrow({ where: { id: developerId }, select: { updatedAt: true, websiteUrl: true } });
    await expect(updateDeveloperCommand(actor, {
      developerId, expectedUpdatedAt: current.updatedAt.toISOString(), websiteUrl: "javascript:alert(1)",
    }, null)).rejects.toMatchObject({ status: 422, code: "DEVELOPER_VALIDATION" });
    expect((await db.developer.findUniqueOrThrow({ where: { id: developerId } })).websiteUrl).toBe(current.websiteUrl);
    await expect(updateDeveloperCommand(actor, {
      developerId, expectedUpdatedAt: current.updatedAt.toISOString(), logoMediaId: privateMediaId,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
  });

  test("creates an unverified developer with audit and public-index outbox event", async () => {
    const result = await createDeveloperCommand(actor, {
      name: "New Test Developer", slug: `${prefix}-created`, websiteUrl: "https://example.invalid", logoMediaId: publicMediaId,
    }, null);
    const [developer, audit, event] = await Promise.all([
      db.developer.findUniqueOrThrow({ where: { id: result.id } }),
      db.auditLog.findFirst({ where: { resourceId: result.id } }),
      db.outboxEvent.findFirst({ where: { aggregateId: result.id } }),
    ]);
    expect(developer.verificationStatus).toBe("UNVERIFIED");
    expect(developer.lastVerifiedAt).toBeNull();
    expect(developer.isDemoData).toBe(false);
    expect(developer.logoMediaId).toBe(publicMediaId);
    expect(await db.developer.findFirst({ where: { id: result.id, ...PUBLIC_DEVELOPER_WHERE } })).toBeNull();
    expect(audit?.action).toBe("developer.create");
    expect(event?.eventType).toBe("developer.updated");
  });
});

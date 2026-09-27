import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { updateMediaMetadata } from "@/server/domain/media-command";

const prefix = `media-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "media-command@example.invalid", name: "Media command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["media:update"], mfaVerified: true,
};

async function createAsset(isPrivate = false) {
  return db.mediaAsset.create({
    data: {
      storageKey: `${prefix}/${Math.random().toString(16).slice(2)}.jpg`,
      url: isPrivate ? "private-object://integration-test" : "/uploads/integration-test.jpg",
      mimeType: "image/jpeg", sizeBytes: 1200, kind: "IMAGE", isPrivate,
    },
  });
}

async function cleanup() {
  const assets = await db.mediaAsset.findMany({ where: { storageKey: { startsWith: prefix } }, select: { id: true } });
  const ids = assets.map((asset) => asset.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.mediaAsset.deleteMany({ where: { id: { in: ids } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional public media metadata command", () => {
  test("updates accessibility metadata with optimistic version, audit, and outbox", async () => {
    const asset = await createAsset();
    const updated = await updateMediaMetadata(actor, {
      mediaAssetId: asset.id, expectedUpdatedAt: asset.updatedAt.toISOString(),
      altText: "A neutral test image description", caption: "Test caption",
    }, null);
    const saved = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(saved.altText).toBe("A neutral test image description");
    expect(saved.caption).toBe("Test caption");
    expect(updated.updatedAt).toBe(saved.updatedAt.toISOString());
    expect(await db.auditLog.count({ where: { resourceId: asset.id, action: "media.metadata_update" } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { aggregateId: asset.id, eventType: "media.updated" } })).toBe(1);
    await expect(updateMediaMetadata(actor, {
      mediaAssetId: asset.id, expectedUpdatedAt: asset.updatedAt.toISOString(), altText: "Stale", caption: null,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  test("refuses private portfolio media without changing its privacy state", async () => {
    const asset = await createAsset(true);
    await expect(updateMediaMetadata(actor, {
      mediaAssetId: asset.id, expectedUpdatedAt: asset.updatedAt.toISOString(), altText: "Not public", caption: null,
    }, null)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).isPrivate).toBe(true);
  });
});

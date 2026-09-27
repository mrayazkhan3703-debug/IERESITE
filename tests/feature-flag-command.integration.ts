import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { updateFeatureFlagCommand } from "@/server/domain/feature-flag-command";

const prefix = `flag-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const flagKey = `${prefix}-flag`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "flag-command@example.invalid", name: "Feature flag command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["property:read", "property:update"], mfaVerified: true,
};

async function cleanup() {
  const flag = await db.featureFlag.findUnique({ where: { key: flagKey }, select: { id: true } });
  if (flag) {
    await db.auditLog.deleteMany({ where: { resourceId: flag.id } });
    await db.featureFlag.delete({ where: { id: flag.id } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
  await db.featureFlag.create({ data: { id: `${prefix}-id`, key: flagKey, description: "Integration fixture", isEnabled: false, rolloutPercent: 0 } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional feature flag command", () => {
  test("records an optimistic flag edit and refuses a stale overwrite", async () => {
    const before = await db.featureFlag.findUniqueOrThrow({ where: { key: flagKey } });
    const result = await updateFeatureFlagCommand(actor, {
      key: flagKey, expectedUpdatedAt: before.updatedAt.toISOString(), isEnabled: true, rolloutPercent: 25,
    }, "127.0.0.1");
    const updated = await db.featureFlag.findUniqueOrThrow({ where: { key: flagKey } });
    const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: before.id, action: "flag.update" } });
    expect(result).toMatchObject({ ok: true, key: flagKey, isEnabled: true, rolloutPercent: 25 });
    expect(updated.updatedBy).toBe(actor.email);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect(JSON.parse(audit.beforeJson ?? "null")).toEqual({ isEnabled: false, rolloutPercent: 0 });
    expect(JSON.parse(audit.afterJson ?? "null")).toEqual({ isEnabled: true, rolloutPercent: 25 });

    await expect(updateFeatureFlagCommand(actor, {
      key: flagKey, expectedUpdatedAt: before.updatedAt.toISOString(), isEnabled: false,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect((await db.featureFlag.findUniqueOrThrow({ where: { key: flagKey } })).isEnabled).toBe(true);
    expect(await db.auditLog.count({ where: { resourceId: before.id, action: "flag.update" } })).toBe(1);
  });
});

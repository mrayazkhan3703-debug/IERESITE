import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { createSession, getSessionUser } from "@/server/auth";
import { ROLE_PERMISSION_MANIFEST } from "@/server/authz-policy";
import { consumeAccountToken, hashAccountToken, issueAccountToken } from "@/server/account-tokens";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `auth-test-user-${suffix}`;
const roleId = `auth-test-role-${suffix}`;
const permissionId = `auth-test-permission-${suffix}`;
const roleKey = `AUTH_TEST_${suffix}`;
const permissionKey = `auth-test:${suffix}`;
const lifecycleUserId = `auth-lifecycle-user-${suffix}`;

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.deleteMany({ where: { id: lifecycleUserId } });
  await db.role.deleteMany({ where: { id: roleId } });
  await db.permission.deleteMany({ where: { id: permissionId } });
  await db.$disconnect();
});

describe("database-backed sessions", () => {
  test("migration grants match the canonical policy manifest", async () => {
    for (const [roleKey, expected] of Object.entries(ROLE_PERMISSION_MANIFEST)) {
      const role = await db.role.findUnique({
        where: { key: roleKey },
        include: { rolePermissions: { include: { permission: true } } },
      });
      expect(role).not.toBeNull();
      expect(role?.rolePermissions.map((grant) => grant.permission.key).sort())
        .toEqual([...expected].sort());
    }
  });

  test("loads grants from PostgreSQL and revokes every session when a user is inactive", async () => {
    await db.permission.create({ data: { id: permissionId, key: permissionKey } });
    await db.role.create({
      data: {
        id: roleId,
        key: roleKey,
        name: "Auth integration role",
        rolePermissions: { create: { permissionId } },
      },
    });
    await db.user.create({
      data: {
        id: userId,
        email: `auth-${suffix}@example.invalid`,
        roles: { create: { roleId } },
      },
    });

    const firstToken = await createSession(userId);
    await createSession(userId);
    const expectedHash = createHash("sha256").update(firstToken).digest("hex");
    const stored = await db.session.findUnique({ where: { tokenHash: expectedHash } });
    expect(stored?.tokenHash).toBe(expectedHash);
    expect(stored?.tokenHash).not.toBe(firstToken);
    const active = await getSessionUser(firstToken);
    expect(active?.permissions).toEqual([permissionKey]);
    expect(active?.roles).toEqual([roleKey]);

    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await getSessionUser(firstToken)).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
  });
});

describe("one-time account tokens", () => {
  test("stores only hashes, enforces purpose, and consumes a token once", async () => {
    await db.user.create({
      data: { id: lifecycleUserId, email: `lifecycle-${suffix}@example.invalid` },
    });
    const raw = await issueAccountToken({
      userId: lifecycleUserId,
      purpose: "VERIFY_EMAIL",
      ttlMinutes: 10,
    });
    const stored = await db.accountToken.findUnique({ where: { tokenHash: hashAccountToken(raw) } });
    expect(stored?.tokenHash).not.toBe(raw);
    expect(await consumeAccountToken(raw, "RESET_PASSWORD", async () => true)).toBeNull();

    const first = await consumeAccountToken(raw, "VERIFY_EMAIL", async (tx, token) => {
      await tx.user.update({ where: { id: token.userId }, data: { emailVerified: new Date() } });
      return token.userId;
    });
    expect(first).toBe(lifecycleUserId);
    expect(await consumeAccountToken(raw, "VERIFY_EMAIL", async () => true)).toBeNull();
    expect((await db.user.findUnique({ where: { id: lifecycleUserId } }))?.emailVerified).not.toBeNull();
  });
});

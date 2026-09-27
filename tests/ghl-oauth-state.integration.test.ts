import { afterAll, beforeAll, expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { PrismaGhlOAuthStateStore } from "@/server/crm/ghl-oauth";

const store = new PrismaGhlOAuthStateStore(db);
const userId = `test-ghl-user-${randomBytes(8).toString("hex")}`;
const sessionId = `test-ghl-session-${randomBytes(8).toString("hex")}`;
const stateHash = createHash("sha256").update(randomBytes(32)).digest("hex");
const expiredHash = createHash("sha256").update(randomBytes(32)).digest("hex");

beforeAll(async () => {
  await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "Synthetic GHL OAuth Test User" } });
});

afterAll(async () => {
  await db.ghlOAuthState.deleteMany({ where: { userId, sessionId } });
  await db.auditLog.deleteMany({ where: { actorId: userId, action: "ghl.oauth.start", resourceId: "ghl" } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

it("persists hashed OAuth state and allows exactly one matching, unexpired session to consume it", async () => {
  const now = new Date();
  await store.issue({
    stateHash,
    userId,
    sessionId,
    redirectUri: "http://localhost:3000/api/admin/integrations/ghl/oauth/callback",
    expiresAt: new Date(now.getTime() + 60_000),
  });

  const wrongSession = await store.consume({ stateHash, userId, sessionId: "another-session", now });
  expect(wrongSession).toBeNull();
  const consumed = await Promise.all([
    store.consume({ stateHash, userId, sessionId, now }),
    store.consume({ stateHash, userId, sessionId, now }),
  ]);
  expect(consumed.filter(Boolean)).toHaveLength(1);
  expect(await db.ghlOAuthState.findUnique({ where: { stateHash } })).toBeNull();

  await store.issue({
    stateHash: expiredHash,
    userId,
    sessionId,
    redirectUri: "http://localhost:3000/api/admin/integrations/ghl/oauth/callback",
    expiresAt: new Date(now.getTime() - 1),
  });
  expect(await store.consume({ stateHash: expiredHash, userId, sessionId, now })).toBeNull();
  const cleanupHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  await store.issue({
    stateHash: cleanupHash,
    userId,
    sessionId,
    redirectUri: "http://localhost:3000/api/admin/integrations/ghl/oauth/callback",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  expect(await db.ghlOAuthState.findUnique({ where: { stateHash: expiredHash } })).toBeNull();
  await db.ghlOAuthState.deleteMany({ where: { stateHash: cleanupHash } });
});

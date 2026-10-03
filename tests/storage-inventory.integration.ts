import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";

const prefix = `storage-inventory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userIds: string[] = [], cookies: string[] = [];
const base = process.env.TEST_BASE_URL ?? "http://web:3000";
beforeAll(async () => {
  await db.mediaAsset.create({ data: { id: prefix, storageKey: `private/portfolio/${prefix}.pdf`, url: "/api/media/private-fixture/content",
    kind: "DOCUMENT", mimeType: "application/pdf", sizeBytes: 7, isPrivate: true } });
  for (const roleKey of ["OWNER", "ADMIN"]) {
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    const id = `${prefix}-${roleKey.toLowerCase()}`;
    await db.user.create({ data: { id, email: `${id}@example.invalid`, emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
    userIds.push(id); cookies.push(`ie_session=${await createSession(id, { mfaVerified: true })}`);
  }
});
afterAll(async () => {
  await db.mediaAsset.deleteMany({ where: { id: prefix } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.$disconnect();
});
test("unauthenticated and non-owner users cannot enumerate private storage references", async () => {
  expect((await fetch(`${base}/api/admin/media/storage-inventory`)).status).toBe(401);
  expect((await fetch(`${base}/api/admin/media/storage-inventory`, { headers: { cookie: cookies[1] } })).status).toBe(403);
});
test("owner inventory includes retained media without disclosing credentials and cannot be cached", async () => {
  const response = await fetch(`${base}/api/admin/media/storage-inventory`, { headers: { cookie: cookies[0] } });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json();
  expect(body.media.length).toBe(await db.mediaAsset.count());
  expect(body.backupAcceptance).toBe("NOT_VERIFIED");
  const privateRecord = body.media.find((row: { id: string }) => row.id === prefix);
  expect(privateRecord.isPrivate).toBe(true);
  expect(Object.keys(privateRecord).sort()).toEqual(["checksum", "id", "isPrivate", "kind", "mimeType", "sizeBytes", "storageKey", "variantsJson"]);
  expect(JSON.stringify(body)).not.toContain("ACCESS_KEY");
});

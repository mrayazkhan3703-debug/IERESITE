import { beforeAll, afterAll, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
const base = process.env.TEST_BASE_URL ?? "http://web:3000";
const prefix = `cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let ownerCookie = "", adminCookie = "";
const demo = `${prefix}-demo`, company = `${prefix}-company`;
async function post(body: unknown, cookie = ownerCookie) {
  return fetch(`${base}/api/admin/properties/demo-cleanup`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  for (const name of ["a", "b"]) await db.organization.create({ data: { id: `${prefix}-${name}`, slug: `${prefix}-${name}`, name: "Synthetic cleanup organization" } });
  for (const [name, role] of [["owner", "OWNER"], ["admin", "ADMIN"]]) {
    const grant = await db.role.findUniqueOrThrow({ where: { key: role } });
    await db.user.create({ data: { id: `${prefix}-${name}`, email: `${prefix}-${name}@example.invalid`, emailVerified: new Date(), organizationId: `${prefix}-${name === "owner" ? "a" : "b"}`, roles: { create: { roleId: grant.id } } } });
  }
  ownerCookie = `ie_session=${await createSession(`${prefix}-owner`, { mfaVerified: true })}`;
  adminCookie = `ie_session=${await createSession(`${prefix}-admin`, { mfaVerified: true })}`;
  await db.community.create({ data: { id: prefix, name: "Synthetic cleanup community", slug: prefix, areaType: "WATERFRONT", lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
  await db.mediaAsset.create({ data: { id: prefix, storageKey: `public/media/${prefix}.jpg`, url: `/api/media/${prefix}/content`, kind: "IMAGE", mimeType: "image/jpeg", sizeBytes: 100 } });
  for (const id of [demo, company]) await db.property.create({ data: { id, slug: id, title: "Synthetic cleanup fixture", communityId: prefix, lat: 25, lng: 55, ownerOrganizationId: `${prefix}-a`, isDemoData: id === demo, sourceType: id === demo ? "DEMO_SEED" : "INTERNAL", publicationStatus: "PUBLISHED", media: { create: { mediaId: prefix, isCover: true } }, listings: { create: { listingType: "SALE", priceMinor: 10000n, publishedAt: new Date(), availabilityStatus: "AVAILABLE" } } } });
  await db.agent.create({ data: { id: prefix, name: "Preserved synthetic team fixture", slug: prefix, ownerOrganizationId: `${prefix}-a`, publicTeam: true } });
});
afterAll(async () => {
  const events = await db.outboxEvent.findMany({ where: { aggregateId: { in: [demo, company] } }, select: { id: true } });
  const jobs = await db.jobRun.findMany({ where: { idempotencyKey: { in: events.map(e => `outbox:${e.id}:search.index.property`) } }, select: { id: true } });
  await db.deadLetterEvent.deleteMany({ where: { sourceId: { in: jobs.map(j => j.id) } } });
  await db.jobRun.deleteMany({ where: { id: { in: jobs.map(j => j.id) } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [demo, company] } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: [`${prefix}-owner`, `${prefix}-admin`] } } });
  await db.property.deleteMany({ where: { id: { in: [demo, company] } } });
  await db.agent.deleteMany({ where: { id: prefix } });
  await db.mediaAsset.deleteMany({ where: { id: prefix } });
  await db.community.deleteMany({ where: { id: prefix } });
  await db.user.deleteMany({ where: { id: { in: [`${prefix}-owner`, `${prefix}-admin`] } } });
  await db.organization.deleteMany({ where: { id: { in: [`${prefix}-a`, `${prefix}-b`] } } });
  await db.$disconnect();
});
test("reviewed cleanup protects company records, organization boundaries, people and shared media", async () => {
  expect((await post({ mode: "preview", propertyIds: [demo, company] })).status).toBe(422);
  expect((await post({ mode: "preview", propertyIds: [demo] }, adminCookie)).status).toBe(403);
  expect((await post({ mode: "archive", propertyIds: [demo] })).status).toBe(409);
  const before = await db.property.findUniqueOrThrow({ where: { id: demo } });
  const previewResponse = await post({ mode: "preview", propertyIds: [demo] });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as { previewToken: string };
  await db.property.update({ where: { id: demo }, data: { title: "Edited synthetic cleanup fixture", updatedAt: new Date(before.updatedAt.getTime() + 1) } });
  expect((await post({ mode: "archive", propertyIds: [demo], previewToken: preview.previewToken })).status).toBe(409);
  const refreshed = await post({ mode: "preview", propertyIds: [demo] }).then(r => r.json()) as { previewToken: string };
  const request = { mode: "archive", propertyIds: [demo], previewToken: refreshed.previewToken };
  expect((await post(request)).status).toBe(200);
  const replay = await post(request);
  expect(replay.status).toBe(200);
  expect((await replay.json()).duplicateRequest).toBe(true);
  expect((await db.property.findUniqueOrThrow({ where: { id: demo } })).publicationStatus).toBe("ARCHIVED");
  expect((await db.property.findUniqueOrThrow({ where: { id: company } })).publicationStatus).toBe("PUBLISHED");
  expect((await db.listing.findFirstOrThrow({ where: { propertyId: demo } })).availabilityStatus).toBe("WITHDRAWN");
  expect(await db.propertyMedia.count({ where: { mediaId: prefix } })).toBe(2);
  expect(await db.mediaAsset.count({ where: { id: prefix } })).toBe(1);
  expect((await db.agent.findUniqueOrThrow({ where: { id: prefix } })).publicTeam).toBe(true);
  expect(await db.outboxEvent.count({ where: { aggregateId: demo, eventType: "property.updated" } })).toBe(1);
  expect((await fetch(`${base}/api/properties/${demo}`)).status).toBe(404);
  expect((await fetch(`${base}/api/properties/${company}`)).status).toBe(200);
}, 60000);

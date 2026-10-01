import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { PUBLIC_AGENT_WHERE, PUBLIC_PROJECT_WHERE, PUBLIC_PROPERTY_WHERE } from "@/server/domain/visibility";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import { updateManagedUserCommand } from "@/server/domain/user-admin-command";
import { createSession, type SessionUser } from "@/server/auth";
import { audit } from "@/server/auth";
import { reindexProperty, search, autocomplete } from "@/server/search/service";
import { searchStateSchema } from "@/server/search/types";
import { updatePropertyCommand } from "@/server/domain/property-command";
const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
if (!["web", "web-test", "localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || !["postgres", "db", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Security tests require disposable services.");
const prefix = "security-current-" + randomUUID(), ownerId = prefix + "-owner", userId = prefix + "-user", agentId = prefix + "-agent", orgId = prefix + "-org", communityId = prefix + "-community", projectId = prefix + "-project", propertyId = prefix + "-property";
let cookie = "";
const owner: SessionUser = { id: ownerId, sessionId: prefix, email: ownerId + "@example.invalid", name: "Verification", organizationId: null, roles: ["OWNER"], permissions: ["*"], mfaVerified: true };
beforeAll(async () => {
  await db.organization.create({ data: { id: orgId, slug: orgId, name: "Disposable security organization" } });
  await db.user.create({ data: { id: ownerId, email: owner.email, emailVerified: new Date(), roles: { create: { role: { connect: { key: "OWNER" } } } } } });
  await db.user.create({ data: { id: userId, email: userId + "@example.invalid", emailVerified: new Date(), organizationId: orgId, roles: { create: { role: { connect: { key: "AGENT" } } } } } });
  cookie = `ie_session=${await createSession(ownerId, { mfaVerified: true })}`;
  await db.agent.create({ data: { id: agentId, userId, name: "Disposable advisor", slug: agentId, active: true, publicAdvisor: true } });
  await db.community.create({ data: { id: communityId, slug: communityId, name: "Disposable community", lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
  await db.developer.create({ data: { id: prefix + "-developer", slug: prefix + "-developer", name: "Disposable developer" } });
  await db.project.create({ data: { id: projectId, slug: projectId, name: "Disposable project", communityId, developerId: prefix + "-developer", lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
  await db.property.create({ data: { id: propertyId, slug: propertyId, title: "Disposable property", communityId, projectId, propertyType: "APARTMENT", bedrooms: 1, bathrooms: 1, lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
});
afterAll(async () => {
  await db.searchDocument.deleteMany({ where: { propertyId } });
  await db.auditLog.deleteMany({ where: { actorId: ownerId } }); await db.outboxEvent.deleteMany({ where: { aggregateId: userId } });
  await db.property.deleteMany({ where: { id: propertyId } }); await db.project.deleteMany({ where: { id: projectId } });
  await db.community.deleteMany({ where: { id: communityId } }); await db.developer.deleteMany({ where: { id: prefix + "-developer" } });
  await db.agent.deleteMany({ where: { id: agentId } }); await db.user.deleteMany({ where: { id: { in: [ownerId, userId] } } }); await db.organization.deleteMany({ where: { id: orgId } }); await db.$disconnect();
});
test("current parent publication controls dependent public reads", async () => {
  expect(await db.property.count({ where: { id: propertyId, ...PUBLIC_PROPERTY_WHERE } })).toBe(1);
  expect((await getPropertyDetailV2(propertyId))?.listingUpdatedAt).toBeNull();
  await db.project.update({ where: { id: projectId }, data: { publicationStatus: "DRAFT" } });
  expect(await getPropertyDetailV2(propertyId)).toBeNull();
  await db.project.update({ where: { id: projectId }, data: { publicationStatus: "PUBLISHED" } });
  await db.community.update({ where: { id: communityId }, data: { publicationStatus: "DRAFT" } });
  expect(await db.project.count({ where: { id: projectId, ...PUBLIC_PROJECT_WHERE } })).toBe(0);
  expect(await getPropertyDetailV2(propertyId)).toBeNull();
  expect((await fetch(baseUrl + "/api/properties/" + propertyId)).status).toBe(404);
  await db.community.update({ where: { id: communityId }, data: { publicationStatus: "PUBLISHED" } });
});
test("linked advisor accounts are withdrawn after suspension and do not auto-republish", async () => {
  expect(await db.agent.count({ where: { id: agentId, ...PUBLIC_AGENT_WHERE } })).toBe(1);
  await db.user.update({ where: { id: userId }, data: { isActive: false } });
  expect(await db.agent.count({ where: { id: agentId, ...PUBLIC_AGENT_WHERE } })).toBe(0);
  const target = await db.user.update({ where: { id: userId }, data: { isActive: true } });
  await updateManagedUserCommand(owner, { userId, expectedUpdatedAt: target.updatedAt.toISOString(), isActive: false }, null);
  expect(await db.agent.findUnique({ where: { id: agentId }, select: { active: true, publicAdvisor: true } })).toEqual({ active: false, publicAdvisor: false });
  await db.user.update({ where: { id: userId }, data: { isActive: true } });
  expect(await db.agent.count({ where: { id: agentId, ...PUBLIC_AGENT_WHERE } })).toBe(0);
});
test("search, facets and autocomplete withdraw current parents without rebuilding cached projections", async () => {
  await db.agent.update({ where: { id: agentId }, data: { active: false, publicAdvisor: false } });
  await db.listing.create({ data: { id: prefix + "-listing", propertyId, agentId, listingType: "SALE", priceMinor: 100000n, publishedAt: new Date(Date.now() - 60000) } });
  await reindexProperty(propertyId);
  const state = searchStateSchema.parse({ listingType: "SALE", communities: [communityId], page: 1, pageSize: 10 });
  expect((await search(state)).results.some(row => row.slug === propertyId)).toBe(true);
  expect((await search(state)).results.find(row => row.slug === propertyId)?.agent).toBeNull();
  await db.project.update({ where: { id: projectId }, data: { publicationStatus: "DRAFT" } });
  expect((await search(state)).total).toBe(0);
  await db.project.update({ where: { id: projectId }, data: { publicationStatus: "PUBLISHED" } });
  expect((await search(state)).total).toBe(1);
  await db.community.update({ where: { id: communityId }, data: { publicationStatus: "DRAFT" } });
  const withdrawn = await search(state);
  expect(withdrawn.total).toBe(0); expect(withdrawn.facets.communities).toEqual([]);
  expect((await autocomplete("Disposable property", 20)).some(row => row.slug === propertyId)).toBe(false);
  await db.community.update({ where: { id: communityId }, data: { publicationStatus: "PUBLISHED" } });
});
test("database trigger lookup is fixed and browser roles cannot access the application schema", async () => {
  const functions = await db.$queryRaw<{ proconfig: string[] }[]>`SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='iere_sync_point_geography'`;
  expect(functions[0].proconfig).toContain("search_path=pg_catalog");
  const grants = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='public' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'))) AND a.privilege_type='USAGE'`;
  expect(Number(grants[0].count)).toBe(0);
});
test("publishing rejects a private project atomically instead of reporting a public hidden property", async () => {
  const property = await db.property.update({ where: { id: propertyId }, data: { publicationStatus: "DRAFT" } });
  await db.project.update({ where: { id: projectId }, data: { publicationStatus: "DRAFT" } });
  try {
    await expect(updatePropertyCommand(owner, { propertyId, expectedUpdatedAt: property.updatedAt.toISOString(), publicationStatus: "PUBLISHED", title: "Must roll back" }, null)).rejects.toThrow("linked project");
    const unchanged = await db.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(unchanged.title).toBe(property.title);
    expect(unchanged.publicationStatus).toBe("DRAFT");
    expect(unchanged.updatedAt).toEqual(property.updatedAt);
  } finally {
    await db.project.update({ where: { id: projectId }, data: { publicationStatus: "PUBLISHED" } });
    await db.property.update({ where: { id: propertyId }, data: { publicationStatus: "PUBLISHED" } });
  }
});
test("audit responses redact legacy credentials, tolerate broken JSON and bound pagination", async () => {
  await audit({ actorId: ownerId, action: "verification", resourceType: prefix, resourceId: prefix, after: { accessToken: "fixture-sensitive" } });
  await db.auditLog.create({ data: { actorId: ownerId, actorType: "USER", action: "legacy", resourceType: prefix, resourceId: prefix, beforeJson: '{"refreshToken":"fixture-sensitive"}', afterJson: '{"broken":"' } });
  expect((await fetch(baseUrl + "/api/admin/audit")).status).toBe(401);
  const response = await fetch(baseUrl + "/api/admin/audit?resource=" + prefix, { headers: { cookie } });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.text(); expect(body).not.toContain("fixture-sensitive"); expect(body).toContain("unavailable");
  for (const path of ["audit", "jobs", "crm"]) expect((await fetch(baseUrl + "/api/admin/" + path + "?page=not-a-number", { headers: { cookie } })).status).toBe(400);
});

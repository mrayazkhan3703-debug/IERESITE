import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { db } from "@/lib/db";
import { createSession, type SessionUser } from "@/server/auth";
import { createPropertyCommand, updatePropertyCommand } from "@/server/domain/property-command";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";
import { getAgentDetailV2, listAgents, listTeam } from "@/server/domain/read-models";
import { canonicalSitemapEntries } from "@/server/seo/sitemap";
import { agentProfileScope } from "@/server/domain/resource-policy";
const prefix = "cms-publication-" + crypto.randomUUID();
const userId = prefix + "-user", orgId = prefix + "-org", communityId = prefix + "-community";
const actor: SessionUser = { sessionId: prefix, id: userId, email: prefix + "@example.invalid", name: "Synthetic owner",
  organizationId: orgId, roles: ["OWNER"], permissions: ["agent:create", "agent:update", "property:create", "property:update"], mfaVerified: true };
const base = process.env.TEST_BASE_URL ?? "http://web:3000";
let cookie = "";
const propertyInput = () => ({ communityId, title: "Synthetic publication test", slug: prefix + "-property", propertyType: "APARTMENT",
  bedrooms: 2, bathrooms: 2, lat: 25, lng: 55, locationPrecision: "BUILDING" as const, listingType: "SALE" as const, priceAed: 100, availabilityStatus: "AVAILABLE" as const });
beforeAll(async () => {
  await db.organization.create({ data: { id: orgId, name: "Synthetic org", slug: orgId } });
  const role = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: userId, email: actor.email, organizationId: orgId, emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
  cookie = "ie_session=" + await createSession(userId, { mfaVerified: true });
  await db.community.create({ data: { id: communityId, name: "Synthetic community", slug: communityId, areaType: "RESIDENTIAL", lat: 25, lng: 55, publicationStatus: "PUBLISHED" } });
});
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  const entities = [...await db.property.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } }), ...await db.agent.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } })];
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: entities.map(row => row.id) } } });
  await db.property.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.agent.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.community.delete({ where: { id: communityId } });
  await db.user.delete({ where: { id: userId } });
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});
describe("direct CMS publication", () => {
  test("property POST creates a published property and listing atomically", async () => {
    const response = await fetch(base + "/api/admin/properties", { method: "POST", headers: { cookie, "x-requested-with": "fetch", "content-type": "application/json" }, body: JSON.stringify({ ...propertyInput(), publicationStatus: "PUBLISHED" }) });
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string };
    const row = await db.property.findUniqueOrThrow({ where: { id: result.id }, include: { listings: true } });
    expect(row.publicationStatus).toBe("PUBLISHED"); expect(row.listings[0].publishedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { resourceId: row.id, action: "property.create_publish" } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { aggregateId: row.id } })).toBe(1);
  });
  test("expired and private-community create failures leave no entity", async () => {
    await expect(createPropertyCommand(actor, { ...propertyInput(), slug: prefix + "-expired", publicationStatus: "PUBLISHED", expiresAt: new Date(Date.now() - 1000).toISOString() }, null)).rejects.toMatchObject({ code: "PUBLICATION_VALIDATION", details: expect.arrayContaining([{ path: "expiresAt", message: "Listing expiry must be in the future when supplied." }]) });
    await db.community.update({ where: { id: communityId }, data: { publicationStatus: "DRAFT" } });
    await expect(createPropertyCommand(actor, { ...propertyInput(), slug: prefix + "-private", publicationStatus: "PUBLISHED" }, null)).rejects.toMatchObject({ code: "PUBLICATION_VALIDATION" });
    expect(await db.property.count({ where: { slug: { in: [prefix + "-expired", prefix + "-private"] } } })).toBe(0);
    await db.community.update({ where: { id: communityId }, data: { publicationStatus: "PUBLISHED" } });
  });
  test("publication evaluates corrected coordinates rather than stale stored coordinates", async () => {
    const created = await createPropertyCommand(actor, { ...propertyInput(), slug: prefix + "-coords" }, null);
    await db.property.update({ where: { id: created.id }, data: { lat: 100 } });
    const current = await db.property.findUniqueOrThrow({ where: { id: created.id } });
    await updatePropertyCommand(actor, { propertyId: created.id, expectedUpdatedAt: current.updatedAt.toISOString(), lat: 25, lng: 55, publicationStatus: "PUBLISHED" }, null);
    expect((await db.property.findUniqueOrThrow({ where: { id: created.id } })).publicationStatus).toBe("PUBLISHED");
  });
  test("a team member publishes without a login, appears publicly, and withdraws independently", async () => {
    const created = await createAgentProfileCommand(actor, { name: "Synthetic staff", slug: prefix + "-staff", jobTitle: "Office manager", publicTeam: true }, null);
    const row = await db.agent.findUniqueOrThrow({ where: { id: created.agentId } });
    expect(row.userId).toBeNull(); expect(row.ownerOrganizationId).toBe(orgId); expect(row.active).toBe(true);
    expect(row.publicAdvisor).toBe(false); expect(row.publicTeam).toBe(true);
    expect((await listTeam()).some(row => row.id === created.agentId)).toBe(true);
    expect((await listAgents()).some(row => row.id === created.agentId)).toBe(false);
    expect((await getAgentDetailV2(row.slug))?.listings).toEqual([]);
    expect((await canonicalSitemapEntries()).some(entry => entry.path === "/agents/" + row.slug)).toBe(true);
    expect(await db.agent.count({ where: { id: row.id, ...agentProfileScope({ ...actor, roles: ["MANAGER"], organizationId: prefix + "-other" }) } })).toBe(0);
    await expect(updateAgentCommand({ ...actor, roles: ["MANAGER"], organizationId: prefix + "-other" }, { agentId: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), publicTeam: false }, null)).rejects.toMatchObject({ code: "RESOURCE_FORBIDDEN" });
    await updateAgentCommand(actor, { agentId: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), publicTeam: false }, null);
    expect(await getAgentDetailV2(row.slug)).toBeNull();
    expect((await listTeam()).some(member => member.id === created.agentId)).toBe(false);
  });
});

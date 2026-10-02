import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";
import { createPropertyCommand, updatePropertyCommand, type NewPropertyCommandInput } from "@/server/domain/property-command";
import { listPeople, getPropertyDetailV2 } from "@/server/domain/read-models";
import { peopleAdminWhere } from "@/server/domain/agent-directory";
import { submitLead, leadSubmitSchema } from "@/server/domain/lead-service";

const prefix = `people-assignment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const org = prefix + "-org", otherOrg = prefix + "-other", user = prefix + "-user", community = prefix + "-community";
const linkedUser = prefix + "-linked-user";
const agents: string[] = [], properties: string[] = [], leads: string[] = [];
const actor: SessionUser = { id: user, sessionId: prefix, email: prefix + "@example.invalid", name: "Test", organizationId: org, roles: ["ADMIN"], permissions: ["agent:create", "agent:update", "property:create", "property:update"], mfaVerified: true };
let advisor = "", alternate = "", privateAgent = "", outside = "", property = "";
const propertyInput = (slug: string): NewPropertyCommandInput => ({ communityId: community, title: "Synthetic assignment fixture", slug, propertyType: "APARTMENT", bedrooms: 1, bathrooms: 1, lat: 25.2, lng: 55.3, locationPrecision: "BUILDING", listingType: "SALE", priceAed: 1000000, availabilityStatus: "AVAILABLE", publicationStatus: "PUBLISHED" });
beforeAll(async () => {
  if (!["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Disposable database required");
  await db.organization.createMany({ data: [{ id: org, name: "Synthetic people", slug: org }, { id: otherOrg, name: "Synthetic other", slug: otherOrg }] });
  await db.user.create({ data: { id: user, email: actor.email, organizationId: org } });
  await db.community.create({ data: { id: community, name: "Synthetic community", slug: community, ownerOrganizationId: org, publicationStatus: "PUBLISHED", areaType: "RESIDENTIAL", lat: 25.2, lng: 55.3 } });
  for (const [name, publicAdvisor, scopedActor] of [["advisor", true, actor], ["alternate", true, actor], ["private", false, actor], ["outside", true, { ...actor, organizationId: otherOrg }]] as const) {
    const result = await createAgentProfileCommand(scopedActor, { name: "Synthetic " + name, slug: prefix + "-" + name, jobTitle: "Property Consultant", bio: "Synthetic test profile", publicTeam: true, active: true, publicAdvisor, department: "sales" }, null);
    agents.push(result.agentId);
  }
  [advisor, alternate, privateAgent, outside] = agents;
});
afterAll(async () => {
  await db.lead.deleteMany({ where: { id: { in: leads } } });
  await db.contact.deleteMany({ where: { email: { startsWith: prefix } } });
  const resources = [...agents, ...properties];
  await db.auditLog.deleteMany({ where: { resourceId: { in: resources } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...resources, ...leads] } } });
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.agent.deleteMany({ where: { id: { in: agents } } });
  await db.community.delete({ where: { id: community } });
  await db.user.deleteMany({ where: { id: { in: [user, linkedUser] } } });
  await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
});
describe("canonical profiles and property advisor assignment", () => {
  test("account-free advisors publish and unified search stays scoped", async () => {
    const profile = await db.agent.findUniqueOrThrow({ where: { id: advisor } });
    expect(profile.userId).toBeNull(); expect(profile.publicAdvisor).toBe(true);
    expect((await listPeople()).some(person => person.id === advisor && person.publicAdvisor)).toBe(true);
    const search = await db.agent.findMany({ where: peopleAdminWhere(actor, "Property Consultant", "advisors") });
    expect(search.map(row => row.id)).toContain(advisor); expect(search.map(row => row.id)).not.toContain(outside);
    expect((await db.agent.findMany({ where: peopleAdminWhere(actor, "", "team") })).map(row => row.id)).toContain(privateAgent);
  });
  test("creates, changes and clears assignment with audited public rendering", async () => {
    const created = await createPropertyCommand(actor, { ...propertyInput(prefix + "-property"), agentId: advisor }, null);
    property = created.id; properties.push(property);
    const listing = await db.listing.findFirstOrThrow({ where: { propertyId: property } }); expect(listing.agentId).toBe(advisor);
    expect(JSON.stringify(await getPropertyDetailV2(prefix + "-property"))).toContain(advisor);
    const current = await db.property.findUniqueOrThrow({ where: { id: property } });
    await updatePropertyCommand(actor, { propertyId: property, expectedUpdatedAt: current.updatedAt.toISOString(), agentId: alternate }, null);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).agentId).toBe(alternate);
    const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: property, action: "property.update" }, orderBy: { createdAt: "desc" } });
    expect(audit.beforeJson).toContain(advisor); expect(audit.afterJson).toContain(alternate);
    const changed = await db.property.findUniqueOrThrow({ where: { id: property } });
    await updatePropertyCommand(actor, { propertyId: property, expectedUpdatedAt: changed.updatedAt.toISOString(), agentId: null }, null);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).agentId).toBeNull();
  });
  test("rejects private, nonexistent, cross-org and inactive IDs without mutation", async () => {
    for (const id of [privateAgent, outside, "nonexistent"]) {
      await expect(createPropertyCommand(actor, { ...propertyInput(prefix + "-invalid"), agentId: id }, null)).rejects.toMatchObject({ status: 422 });
      const current = await db.property.findUniqueOrThrow({ where: { id: property } });
      await expect(updatePropertyCommand(actor, { propertyId: property, expectedUpdatedAt: current.updatedAt.toISOString(), agentId: id }, null)).rejects.toMatchObject({ status: 422 });
    }
    const profile = await db.agent.findUniqueOrThrow({ where: { id: alternate } });
    await updateAgentCommand(actor, { agentId: alternate, expectedUpdatedAt: profile.updatedAt.toISOString(), active: false, publicAdvisor: false, publicTeam: false }, null);
    await expect(createPropertyCommand(actor, { ...propertyInput(prefix + "-invalid"), agentId: alternate }, null)).rejects.toMatchObject({ status: 422 });
    expect((await listPeople()).some(person => person.id === alternate)).toBe(false);
    expect(await db.property.count({ where: { slug: prefix + "-invalid" } })).toBe(0);
  });
  test("property lead derives the eligible listing advisor and retains context", async () => {
    const current = await db.property.findUniqueOrThrow({ where: { id: property } });
    await updatePropertyCommand(actor, { propertyId: property, expectedUpdatedAt: current.updatedAt.toISOString(), agentId: advisor }, null);
    const result = await submitLead(leadSubmitSchema.parse({ name: "Synthetic lead", email: prefix + "-lead@example.invalid", phone: "+971501234567", intent: "BUY", consentContact: true, entityType: "PROPERTY", entityId: property, agentSlug: prefix + "-outside", pagePath: "/properties/" + prefix + "-property", preferredLocale: "en" }));
    leads.push(result.leadId);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { context: true, events: true } });
    expect(lead.ownerAgentId).toBe(advisor); expect(lead.organizationId).toBe(org); expect(lead.primaryEntityId).toBe(property);
    expect(lead.context?.pagePath).toContain(prefix + "-property");
    expect(lead.events.find(event => event.eventType === "CREATED")?.payloadJson).toContain('"listingId"');
  });
  test("optional account links retain verification and role revocation security", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
    await db.user.create({ data: { id: linkedUser, email: linkedUser + "@example.invalid", organizationId: org, emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
    const initial = await db.agent.findUniqueOrThrow({ where: { id: advisor } });
    await expect(updateAgentCommand(actor, { agentId: advisor, expectedUpdatedAt: initial.updatedAt.toISOString(), userId: user }, null)).rejects.toMatchObject({ code: "INVALID_AGENT_ACCOUNT" });
    await updateAgentCommand(actor, { agentId: advisor, expectedUpdatedAt: initial.updatedAt.toISOString(), userId: linkedUser }, null);
    await db.user.update({ where: { id: linkedUser }, data: { emailVerified: null } });
    expect((await listPeople()).find(person => person.id === advisor)?.publicAdvisor).toBe(false);
    await expect(createPropertyCommand(actor, { ...propertyInput(prefix + "-invalid"), agentId: advisor }, null)).rejects.toMatchObject({ status: 422 });
    const changed = await db.agent.findUniqueOrThrow({ where: { id: advisor } });
    await expect(updateAgentCommand(actor, { agentId: advisor, expectedUpdatedAt: changed.updatedAt.toISOString(), bio: "Edited bio" }, null)).rejects.toMatchObject({ code: "PUBLICATION_VALIDATION" });
  });
});

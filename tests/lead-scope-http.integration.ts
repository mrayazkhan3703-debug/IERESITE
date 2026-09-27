import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  org1: `scope-org-1-${suffix}`,
  org2: `scope-org-2-${suffix}`,
  manager: `scope-manager-${suffix}`,
  agent: `scope-agent-user-${suffix}`,
  analyst: `scope-analyst-${suffix}`,
  agentRecord: `scope-agent-record-${suffix}`,
  contact1: `scope-contact-1-${suffix}`,
  contact2: `scope-contact-2-${suffix}`,
  contact3: `scope-contact-3-${suffix}`,
  lead1: `scope-lead-1-${suffix}`,
  lead2: `scope-lead-2-${suffix}`,
  lead3: `scope-lead-3-${suffix}`,
};
let managerCookie = "";
let agentCookie = "";
let analystCookie = "";

async function cookie(userId: string, mfaVerified = false): Promise<string> {
  return `ie_session=${await createSession(userId, { mfaVerified })}`;
}

beforeAll(async () => {
  await db.organization.createMany({ data: [
    { id: ids.org1, name: "Scope organization one", slug: `scope-org-1-${suffix}` },
    { id: ids.org2, name: "Scope organization two", slug: `scope-org-2-${suffix}` },
  ] });
  const roles = await db.role.findMany({ where: { key: { in: ["MANAGER", "AGENT", "ANALYST"] } } });
  const role = new Map(roles.map((item) => [item.key, item.id]));
  await db.user.create({ data: { id: ids.manager, email: `manager-${suffix}@example.invalid`, organizationId: ids.org1, emailVerified: new Date(), roles: { create: { roleId: role.get("MANAGER")! } } } });
  await db.user.create({ data: { id: ids.agent, email: `agent-${suffix}@example.invalid`, organizationId: ids.org1, emailVerified: new Date(), roles: { create: { roleId: role.get("AGENT")! } } } });
  await db.user.create({ data: { id: ids.analyst, email: `analyst-${suffix}@example.invalid`, organizationId: ids.org1, emailVerified: new Date(), roles: { create: { roleId: role.get("ANALYST")! } } } });
  await db.agent.create({ data: { id: ids.agentRecord, userId: ids.agent, name: "Scoped agent", slug: `scoped-agent-${suffix}` } });
  await db.contact.createMany({ data: [
    { id: ids.contact1, email: `lead1-${suffix}@example.invalid`, dedupeKey: `scope-1-${suffix}` },
    { id: ids.contact2, email: `lead2-${suffix}@example.invalid`, dedupeKey: `scope-2-${suffix}` },
    { id: ids.contact3, email: `lead3-${suffix}@example.invalid`, dedupeKey: `scope-3-${suffix}` },
  ] });
  await db.lead.createMany({ data: [
    { id: ids.lead1, organizationId: ids.org1, contactId: ids.contact1, ownerAgentId: ids.agentRecord, intent: "BUY" },
    { id: ids.lead2, organizationId: ids.org1, contactId: ids.contact2, intent: "RENT" },
    { id: ids.lead3, organizationId: ids.org2, contactId: ids.contact3, intent: "INVEST" },
  ] });
  managerCookie = await cookie(ids.manager, true);
  agentCookie = await cookie(ids.agent);
  analystCookie = await cookie(ids.analyst);
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { resourceId: { in: [ids.lead1, ids.lead2, ids.lead3] } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [ids.lead1, ids.lead2, ids.lead3] } } });
  await db.lead.deleteMany({ where: { id: { in: [ids.lead1, ids.lead2, ids.lead3] } } });
  await db.contact.deleteMany({ where: { id: { in: [ids.contact1, ids.contact2, ids.contact3] } } });
  await db.agent.deleteMany({ where: { id: ids.agentRecord } });
  await db.user.deleteMany({ where: { id: { in: [ids.manager, ids.agent, ids.analyst] } } });
  await db.organization.deleteMany({ where: { id: { in: [ids.org1, ids.org2] } } });
  await db.$disconnect();
});

describe("lead HTTP resource scope", () => {
  test("manager sees only their organization and cannot mutate another", async () => {
    const list = await fetch(`${baseUrl}/api/admin/leads`, { headers: { cookie: managerCookie } });
    expect(list.status).toBe(200);
    const body = await list.json() as { total: number; leads: Array<{ id: string }> };
    expect(body.total).toBe(2);
    expect(body.leads.map((lead) => lead.id).sort()).toEqual([ids.lead1, ids.lead2].sort());

    const crossTenant = await fetch(`${baseUrl}/api/admin/leads`, {
      method: "PATCH",
      headers: { cookie: managerCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ leadId: ids.lead3, expectedUpdatedAt: new Date().toISOString(), status: "CONTACTED" }),
    });
    expect(crossTenant.status).toBe(404);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: ids.lead2 } });
    const update = await fetch(`${baseUrl}/api/admin/leads`, {
      method: "PATCH",
      headers: { cookie: managerCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ leadId: ids.lead2, expectedUpdatedAt: lead.updatedAt.toISOString(), status: "CONTACTED", note: "Integration fixture" }),
    });
    expect(update.status).toBe(200);
    const result = await update.json() as { updatedAt: string };
    expect((await db.lead.findUniqueOrThrow({ where: { id: ids.lead2 } })).status).toBe("CONTACTED");
    expect(await db.leadEvent.count({ where: { leadId: ids.lead2, eventType: "STATUS_CHANGED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { resourceId: ids.lead2, action: "lead.update" } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { aggregateId: ids.lead2, eventType: "lead.status_changed" } })).toBe(1);

    const stale = await fetch(`${baseUrl}/api/admin/leads`, {
      method: "PATCH",
      headers: { cookie: managerCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ leadId: ids.lead2, expectedUpdatedAt: lead.updatedAt.toISOString(), status: "LOST" }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json() as { code: string }).code).toBe("VERSION_CONFLICT");
    expect((await db.lead.findUniqueOrThrow({ where: { id: ids.lead2 } })).updatedAt.toISOString()).toBe(result.updatedAt);
  });

  test("agent sees only assigned leads and cannot reassign", async () => {
    const list = await fetch(`${baseUrl}/api/admin/leads`, { headers: { cookie: agentCookie } });
    expect(list.status).toBe(200);
    const body = await list.json() as { total: number; leads: Array<{ id: string }> };
    expect(body.total).toBe(1);
    expect(body.leads[0].id).toBe(ids.lead1);
    const assign = await fetch(`${baseUrl}/api/admin/leads`, {
      method: "PATCH",
      headers: { cookie: agentCookie, "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ leadId: ids.lead1, expectedUpdatedAt: (await db.lead.findUniqueOrThrow({ where: { id: ids.lead1 } })).updatedAt.toISOString(), ownerAgentId: null }),
    });
    expect(assign.status).toBe(403);
  });

  test("analyst receives organization aggregate data but no raw lead endpoint", async () => {
    const raw = await fetch(`${baseUrl}/api/admin/leads`, { headers: { cookie: analystCookie } });
    expect(raw.status).toBe(403);
    const analytics = await fetch(`${baseUrl}/api/admin/analytics`, { headers: { cookie: analystCookie } });
    expect(analytics.status).toBe(200);
    const body = await analytics.json() as { leadsByIntent: Array<{ intent: string; count: number }> };
    expect(body.leadsByIntent.reduce((sum, item) => sum + item.count, 0)).toBe(2);
    expect(JSON.stringify(body)).not.toContain(`lead1-${suffix}@example.invalid`);
  });
});

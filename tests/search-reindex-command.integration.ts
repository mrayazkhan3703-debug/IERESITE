import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { mapOutboxEventToJob } from "@/server/jobs/outbox";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  organization: `search-reindex-org-${suffix}`,
  owner: `search-reindex-owner-${suffix}`,
  manager: `search-reindex-manager-${suffix}`,
};
let ownerCookie = "";
let managerCookie = "";
let createdEventId: string | null = null;

async function cookie(userId: string) {
  return `ie_session=${await createSession(userId, { mfaVerified: true })}`;
}

beforeAll(async () => {
  await db.organization.create({ data: { id: ids.organization, name: "Search reindex integration", slug: `search-reindex-${suffix}` } });
  const roles = await db.role.findMany({ where: { key: { in: ["OWNER", "MANAGER"] } } });
  const roleIds = new Map(roles.map((role) => [role.key, role.id]));
  await db.user.create({ data: { id: ids.owner, email: `search-owner-${suffix}@example.invalid`, emailVerified: new Date(), roles: { create: { roleId: roleIds.get("OWNER")! } } } });
  await db.user.create({ data: { id: ids.manager, email: `search-manager-${suffix}@example.invalid`, organizationId: ids.organization, emailVerified: new Date(), roles: { create: { roleId: roleIds.get("MANAGER")! } } } });
  ownerCookie = await cookie(ids.owner);
  managerCookie = await cookie(ids.manager);
});

afterAll(async () => {
  if (createdEventId) await db.outboxEvent.deleteMany({ where: { id: createdEventId } });
  await db.auditLog.deleteMany({ where: { action: { startsWith: "search.reindex." }, resourceId: "search-index", actorId: { in: [ids.owner, ids.manager] } } });
  await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.manager] } } });
  await db.organization.deleteMany({ where: { id: ids.organization } });
  await db.$disconnect();
});

describe("Admin search reindex request", () => {
  test("bounded direct rebuild completes and records history independently of queue delivery", async () => {
    const before = await db.outboxEvent.count({ where: { eventType: "search.reindex.requested" } });
    const response = await fetch(`${baseUrl}/api/admin/search/reindex`, { method: "POST", headers: { cookie: ownerCookie, "x-requested-with": "fetch", "content-type": "application/json" }, body: JSON.stringify({ mode: "direct" }) });
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; count: number };
    expect(result.status).toBe("COMPLETED"); expect(result.count).toBeGreaterThanOrEqual(0);
    expect(await db.outboxEvent.count({ where: { eventType: "search.reindex.requested" } })).toBe(before);
    expect(await db.auditLog.count({ where: { actorId: ids.owner, action: "search.reindex.direct.completed" } })).toBe(1);
    const status = await fetch(`${baseUrl}/api/admin/search`, { headers: { cookie: ownerCookie } });
    expect(status.status).toBe(200);
    expect((await status.json() as { history: unknown[] }).history.length).toBeGreaterThan(0);
    expect((await fetch(`${baseUrl}/api/admin/search`, { headers: { cookie: managerCookie } })).status).toBe(403);
  });
  test("requires job-write authority and atomically audits a queued worker request", async () => {
    const denied = await fetch(`${baseUrl}/api/admin/search/reindex`, {
      method: "POST",
      headers: { cookie: managerCookie, "x-requested-with": "fetch" },
    });
    expect(denied.status).toBe(403);
    expect(await db.outboxEvent.count({
      where: { eventType: "search.reindex.requested", aggregateId: "search-index", payloadJson: { path: ["requestedBy"], equals: ids.manager } },
    })).toBe(0);

    const response = await fetch(`${baseUrl}/api/admin/search/reindex`, {
      method: "POST",
      headers: { cookie: ownerCookie, "x-requested-with": "fetch" },
    });
    expect(response.status).toBe(202);
    const result = await response.json() as { status: string; outboxEventId: string };
    expect(result.status).toBe("QUEUED");
    createdEventId = result.outboxEventId;

    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: result.outboxEventId } });
    expect(event.eventType).toBe("search.reindex.requested");
    expect(event.aggregateId).toBe("search-index");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "search.reindex.request", resourceId: "search-index", actorId: ids.owner } });
    expect(audit.afterJson).toContain(result.outboxEventId);
    expect(mapOutboxEventToJob(event.id, event.eventType, event.aggregateType, event.aggregateId, {})).toEqual({
      key: "search.reindex.all",
      payload: {},
      idempotencyKey: `outbox:${event.id}:search.reindex.all`,
    });
  });
});

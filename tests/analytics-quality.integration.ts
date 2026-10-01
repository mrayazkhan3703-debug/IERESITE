import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { getDataQualitySummary } from "@/server/domain/evidence";
const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
if (!["web", "web-test", "localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || !["postgres", "db", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Analytics verification requires disposable services.");
const prefix = "quality-metrics-" + randomUUID(), userId = prefix + "-analyst", orgId = prefix + "-org", contactId = prefix + "-contact";
let cookie = "";
beforeAll(async () => {
  await db.organization.create({ data: { id: orgId, slug: orgId, name: "Disposable metrics organization" } });
  const role = await db.role.findUniqueOrThrow({ where: { key: "ANALYST" } });
  await db.user.create({ data: { id: userId, email: userId + "@example.invalid", emailVerified: new Date(), organizationId: orgId, roles: { create: { roleId: role.id } } } });
  cookie = `ie_session=${await createSession(userId, { mfaVerified: true })}`;
  await db.contact.create({ data: { id: contactId, dedupeKey: contactId, email: contactId + "@example.invalid" } });
  await db.lead.createMany({ data: [
    { id: prefix + "-recent", organizationId: orgId, contactId, intent: "BUY", sourceChannel: "WEB" },
    { id: prefix + "-old", organizationId: orgId, contactId, intent: "RENT", sourceChannel: "WEB", createdAt: new Date(Date.now() - 31 * 86400000) },
  ] });
  await db.searchQuery.createMany({ data: [
    { id: prefix + "-recent", queryText: prefix + " recent", normalizedText: prefix + " recent" },
    { id: prefix + "-old", queryText: prefix + " old", normalizedText: prefix + " old", createdAt: new Date(Date.now() - 31 * 86400000) },
  ] });
});
afterAll(async () => {
  await db.analyticsEvent.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.searchQuery.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.lead.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.contact.deleteMany({ where: { id: contactId } });
  await db.user.deleteMany({ where: { id: userId } }); await db.organization.deleteMany({ where: { id: orgId } });
  await db.marketRent.deleteMany({ where: { sourceRecordKey: { startsWith: prefix } } });
  await db.$disconnect();
});
describe("measured analytics and validation coverage", () => {
  test("enforces the same window on scoped leads, searches and UTC day rollups", async () => {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0); dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    const dayEnd = new Date(dayStart.getTime() + 86400000), day = dayStart.toISOString().slice(0, 10);
    const previousCount = await db.analyticsEvent.count({ where: { name: "page_view", createdAt: { gte: dayStart, lt: dayEnd } } });
    await db.analyticsEvent.createMany({ data: [0, 1].map((n) => ({ id: prefix + "-event-" + n, name: "page_view", createdAt: new Date(dayStart.getTime() + 60000 * (n + 1)) })) });
    expect((await fetch(baseUrl + "/api/admin/analytics")).status).toBe(401);
    const response = await fetch(baseUrl + "/api/admin/analytics", { headers: { cookie } });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const metrics = await response.json();
    expect(metrics.timezone).toBe("UTC"); expect(metrics.totals.leads).toBe(1);
    expect(metrics.leadsByIntent).toEqual([{ intent: "BUY", count: 1 }]);
    expect(metrics.pageViewsByDay.filter((row: { day: string }) => row.day === day)).toEqual([{ day, count: previousCount + 2 }]);
    expect(metrics.topSearches.some((row: { query: string }) => row.query === prefix + " old")).toBe(false);
    expect(JSON.stringify(metrics)).not.toContain(contactId + "@example.invalid");
    expect(metrics.note).toContain("not total visits"); expect(metrics.scope.leads).toBe("your organization");
  });
  test("marks the 10,000-row scan as partial while preserving full stored totals and dates", async () => {
    const total = 10001;
    for (let offset = 0; offset < total; offset += 500) await db.marketRent.createMany({ data: Array.from({ length: Math.min(500, total - offset) }, (_, index) => ({ id: prefix + "-rent-" + (offset + index), sourceRecordKey: prefix + "-rent-" + (offset + index), source: "DISPOSABLE_TEST", areaName: "Synthetic fixture only", propertyType: "STUDIO", bedrooms: 0, annualRentMinor: 10000n, sizeSqft: 100, contractDate: new Date(), isIllustrative: true })) });
    const summary = await getDataQualitySummary();
    expect(summary.status).toBe("PARTIAL_SCAN"); expect(summary.coverage.rents.truncated).toBe(true);
    expect(summary.coverage.rents.evaluatedRows).toBe(10000); expect(summary.coverage.rents.storedRows).toBeGreaterThanOrEqual(total);
    expect(summary.coverage.rents.illustrativeRows).toBeGreaterThanOrEqual(total); expect(summary.coverage.rents.latestObservedDate).toBeTruthy();
    expect(summary.note).toContain("do not prove source verification"); expect(summary.rents.totalRecords).toBe(10000);
    const response = await fetch(baseUrl + "/api/admin/data-quality", { headers: { cookie } });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).status).toBe("PARTIAL_SCAN");
  }, 30000);
});

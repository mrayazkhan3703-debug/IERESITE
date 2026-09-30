import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { deletePrivateObject } from "@/server/storage/object-store";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const prefix = `market-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ownerId = `${prefix}-owner`, communityId = `${prefix}-community`;
let cookie = "";
const mapping = { externalId: "ID", date: "Date", areaName: "Area", propertyType: "Type", amountAed: "Amount", communitySlug: "Community", sizeSqft: "Size", bedrooms: "Beds" };
const retrievedAt = new Date(Date.now() - 60_000).toISOString();
function post(body: unknown, authenticated = true) {
  return fetch(`${baseUrl}/api/admin/market-data`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body) });
}
async function validate(sourceId: string, amount: number, key: string, extraRows: unknown[] = []) {
  const data = JSON.stringify([{ ID: "0001", Date: "2026-01-15", Area: "Synthetic market fixture", Type: "APARTMENT", Amount: amount, Community: communityId, Size: 1000, Beds: 1 }, ...extraRows]);
  const response = await post({ action: "validate", sourceId, retrievedAt, format: "JSON", data, idempotencyKey: `${prefix}-${key}` });
  expect(response.status).toBe(200);
  return await db.importRun.findUniqueOrThrow({ where: { id: (await response.json() as { importRunId: string }).importRunId } });
}
beforeAll(async () => {
  if (!["localhost", "127.0.0.1", "web", "web-test"].includes(new URL(baseUrl).hostname) || !["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Market import fixtures require disposable local services.");
  const owner = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, emailVerified: new Date(), roles: { create: { roleId: owner.id } } } });
  await db.community.create({ data: { id: communityId, slug: communityId, name: "Synthetic market fixture", areaType: "WATERFRONT", lat: 25.08, lng: 55.14, publicationStatus: "PUBLISHED" } });
  cookie = `ie_session=${await createSession(ownerId, { mfaVerified: true })}`;
});
afterAll(async () => {
  const sources = await db.importSource.findMany({ where: { name: { startsWith: prefix } }, include: { runs: true } });
  const runs = sources.flatMap((s) => s.runs), runIds = runs.map((r) => r.id);
  await db.marketMetric.deleteMany({ where: { communityId } });
  await db.marketTransaction.deleteMany({ where: { communityId } });
  await db.marketRent.deleteMany({ where: { communityId } });
  await db.dataQualityIssue.deleteMany({ where: { entityId: { in: runIds } } });
  await db.importRecord.deleteMany({ where: { importRunId: { in: runIds } } });
  await db.importRun.deleteMany({ where: { id: { in: runIds } } });
  await db.importSource.deleteMany({ where: { id: { in: sources.map((s) => s.id) } } });
  for (const key of new Set(runs.map((r) => r.snapshotRef).filter((v): v is string => Boolean(v)))) await deletePrivateObject(key);
  await db.auditLog.deleteMany({ where: { actorId: ownerId } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.community.deleteMany({ where: { id: communityId } });
  await db.$disconnect();
});
describe("uploaded market data → public explorers", () => {
  test("authenticates, validates without mutation, rejects bad rows and applies idempotently with provenance", async () => {
    expect((await post({ action: "rebuild" }, false)).status).toBe(401);
    const create = await post({ action: "source", source: { name: `${prefix}-transactions`, url: "https://example.invalid/fixture", notes: "Synthetic fixture methodology, disposable database only", datasetKind: "MARKET_TRANSACTION", mapping, staleAfterDays: 90, isIllustrative: false, isActive: true } });
    expect(create.status).toBe(200);
    const source = await create.json() as { id: string };
    const bad = await validate(source.id, 1250000, "reject", [{ ID: "bad", Date: "2026-02-30", Area: "Fixture", Type: "APARTMENT", Amount: 0 }]);
    expect(bad.status).toBe("NEEDS_REVIEW"); expect(bad.recordsFailed).toBe(1);
    expect((await post({ action: "apply", runId: bad.id, expectedSha256: bad.snapshotSha256, confirmSourceReviewed: true })).status).toBe(409);
    expect(await db.marketTransaction.count({ where: { communityId } })).toBe(0);
    const run = await validate(source.id, 1250000.25, "valid");
    expect(run.status).toBe("VALIDATED"); expect(run.snapshotRef?.startsWith("private/imports/")).toBe(true);
    const duplicate = await validate(source.id, 1250000.25, "valid"); expect(duplicate.id).toBe(run.id);
    expect(await db.marketTransaction.count({ where: { communityId } })).toBe(0);
    const applied = await post({ action: "apply", runId: run.id, expectedSha256: run.snapshotSha256, confirmSourceReviewed: true });
    expect(applied.status).toBe(200);
    expect((await post({ action: "apply", runId: run.id, expectedSha256: run.snapshotSha256, confirmSourceReviewed: true })).status).toBe(200);
    const row = await db.marketTransaction.findFirstOrThrow({ where: { communityId } });
    expect(row.amountMinor).toBe(125000025n); expect(row.importRunId).toBe(run.id); expect(row.sourceRecordKey.endsWith(":0001")).toBe(true);
    const explorer = await fetch(`${baseUrl}/api/market/transactions?community=${communityId}`).then((r) => r.json()) as { total: number; rows: { id: string }[] };
    expect(explorer.total).toBe(1); expect(explorer.rows[0].id).toBe(row.id);
    expect(await db.auditLog.count({ where: { actorId: ownerId, action: "market.import.apply" } })).toBe(1);
    const unchanged = await validate(source.id, 1250000.25, "unchanged"); expect(unchanged.duplicatesDetected).toBe(1);
    const stale = await validate(source.id, 1300000, "stale");
    await db.marketTransaction.update({ where: { id: row.id }, data: { amountMinor: 140000000n } });
    expect((await post({ action: "apply", runId: stale.id, expectedSha256: stale.snapshotSha256, confirmSourceReviewed: true })).status).toBe(409);
    const rentSourceResponse = await post({ action: "source", source: { name: `${prefix}-rents`, url: "https://example.invalid/rents", notes: "Synthetic annual rent fixture only", datasetKind: "MARKET_RENT", mapping, staleAfterDays: 90, isIllustrative: false, isActive: true } });
    expect(rentSourceResponse.status).toBe(200);
    const rentSource = await rentSourceResponse.json() as { id: string };
    const rent = await validate(rentSource.id, 100000, "rent");
    expect((await post({ action: "apply", runId: rent.id, expectedSha256: rent.snapshotSha256, confirmSourceReviewed: true })).status).toBe(200);
    const rentExplorer = await fetch(`${baseUrl}/api/market/rents?community=${communityId}`).then((r) => r.json()) as { total: number; rows: { annualRentMinor: string; provenance: { freshness: string; reviewState: string } }[] };
    expect(rentExplorer.total).toBe(1); expect(rentExplorer.rows[0].annualRentMinor).toBe("10000000");
    expect(rentExplorer.rows[0].provenance).toMatchObject({ freshness: "CURRENT", reviewState: "EDITOR_REVIEWED" });
    const rebuild = await post({ action: "rebuild" }); expect(rebuild.status).toBe(200);
    expect((await db.marketMetric.findFirstOrThrow({ where: { communityId, metricKey: "MEDIAN_TRANS_PRICE" } })).valueNumeric).toBe(1400000);
    expect(await db.outboxEvent.count({ where: { aggregateId: { in: [run.id, bad.id, stale.id] } } })).toBe(0);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createSession, type SessionUser } from "@/server/auth";
import { companyImportSource } from "@/server/domain/import-scope";
import { runImport } from "@/server/ingestion/pipeline";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `import-scope-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const orgIds = [`${suffix}-a`, `${suffix}-b`];
const userIds = [`${suffix}-admin-a`, `${suffix}-admin-b`];
const communityId = `${suffix}-community`;
const sourceIds: string[] = [];
const runIds: string[] = [];
const cookies: string[] = [];
const record = { externalId: `${suffix}-external`, title: "Synthetic scope test apartment", community: `Synthetic scope community ${suffix}`, propertyType: "APARTMENT", bedrooms: 2, bathrooms: 2, priceAed: 1000000, description: "Disposable integration fixture", lat: 25.08, lng: 55.14 };

beforeAll(async () => {
  const role = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  for (let i = 0; i < 2; i++) {
    await db.organization.create({ data: { id: orgIds[i], name: `Synthetic scope ${i}`, slug: orgIds[i] } });
    await db.user.create({ data: { id: userIds[i], organizationId: orgIds[i], email: `${userIds[i]}@example.invalid`, emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
    const actor: SessionUser = { id: userIds[i], organizationId: orgIds[i], roles: ["ADMIN"], email: "", sessionId: "", name: null, permissions: [], mfaVerified: true };
    const source = await db.importSource.create({ data: { ...companyImportSource(actor), sourceType: "JSON" } });
    sourceIds.push(source.id);
    cookies.push(`ie_session=${await createSession(userIds[i], { mfaVerified: true })}`);
  }
  await db.community.create({ data: { id: communityId, name: record.community, slug: communityId, areaType: "WATERFRONT", lat: 25.08, lng: 55.14 } });
});

afterAll(async () => {
  const properties = await db.property.findMany({ where: { communityId, sourceId: { startsWith: suffix } }, select: { id: true } });
  const propertyIds = properties.map(p => p.id);
  const events = await db.outboxEvent.findMany({ where: { aggregateId: { in: propertyIds } }, select: { id: true } });
  const jobs = await db.jobRun.findMany({ where: { idempotencyKey: { in: events.map(e => `outbox:${e.id}:search.index.property`) } }, select: { id: true } });
  await db.deadLetterEvent.deleteMany({ where: { sourceId: { in: jobs.map(j => j.id) } } });
  await db.jobRun.deleteMany({ where: { id: { in: jobs.map(j => j.id) } } });
  await db.outboxEvent.deleteMany({ where: { id: { in: events.map(e => e.id) } } });
  await db.importRecord.deleteMany({ where: { importRunId: { in: runIds } } });
  await db.importRun.deleteMany({ where: { importSourceId: { in: sourceIds } } });
  await db.dataQualityIssue.deleteMany({ where: { propertyId: { in: propertyIds } } });
  await db.priceHistory.deleteMany({ where: { propertyId: { in: propertyIds } } });
  await db.listing.deleteMany({ where: { propertyId: { in: propertyIds } } });
  await db.property.deleteMany({ where: { id: { in: propertyIds } } });
  await db.importSource.deleteMany({ where: { id: { in: sourceIds } } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.community.deleteMany({ where: { id: communityId } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.$disconnect();
});

async function importRows(index: number, records: unknown[], dryRun = false) {
  const result = await db.$transaction(tx => runImport({ sourceId: sourceIds[index], records, dryRun, client: tx }), { timeout: 30000 });
  runIds.push(result.runId);
  return result;
}

describe("source-bound company inventory imports", () => {
  test("the same external ID and checksum create separate drafts; refresh and duplicate reuse stay within the source", async () => {
    expect((await importRows(0, [record])).created).toBe(1);
    expect((await importRows(1, [record], true)).wouldCreate).toBe(1);
    expect((await importRows(1, [record])).created).toBe(1);
    const before = await db.property.findMany({ where: { sourceId: record.externalId }, orderBy: { ownerOrganizationId: "asc" } });
    expect(before).toHaveLength(2);
    expect(new Set(before.map(p => p.slug)).size).toBe(2);
    expect(before.map(p => p.ownerOrganizationId)).toEqual(orgIds);
    expect(before.every(p => p.publicationStatus === "DRAFT")).toBe(true);
    expect((await importRows(0, [{ ...record, title: "Changed source A apartment" }])).updated).toBe(1);
    expect((await importRows(1, [record])).skippedDuplicate).toBe(1);
    const after = await db.property.findMany({ where: { sourceId: record.externalId }, orderBy: { ownerOrganizationId: "asc" } });
    expect(after[0].title).toBe("Changed source A apartment");
    expect(after[1].title).toBe(record.title);
    const foreignDetail = await fetch(`${baseUrl}/api/admin/imports/${runIds[0]}`, { headers: { cookie: cookies[1] } });
    expect(foreignDetail.status).toBe(404);
    const history = await fetch(`${baseUrl}/api/admin/imports`, { headers: { cookie: cookies[1] } });
    expect(history.status).toBe(200);
    const data = await history.json() as { runs: { id: string }[] };
    expect(data.runs.some(r => r.id === runIds[0])).toBe(false);
    expect(data.runs.some(r => r.id === runIds[2])).toBe(true);
    // Reintroducing an older source revision is an update, not a duplicate of
    // an arbitrary historical import checksum.
    expect((await importRows(0, [record])).updated).toBe(1);
  });

  test("foreign preview approval is rejected before snapshot storage", async () => {
    const bytes = JSON.stringify([record]);
    const preview = await db.importRun.create({ data: { importSourceId: sourceIds[0], status: "DRY_RUN", dryRun: true, inputFormat: "JSON", finishedAt: new Date(), triggeredBy: `${userIds[1]}@example.invalid`, snapshotSha256: createHash("sha256").update(bytes).digest("hex") } });
    runIds.push(preview.id);
    const response = await fetch(`${baseUrl}/api/admin/imports`, { method: "POST", headers: { cookie: cookies[1], "content-type": "application/json", "x-requested-with": "fetch", "idempotency-key": `${suffix}-foreign-preview` }, body: JSON.stringify({ format: "json", data: [record], dryRun: false, previewRunId: preview.id }) });
    expect(response.status).toBe(409);
    expect(await db.importRun.findUnique({ where: { idempotencyKey: `${suffix}-foreign-preview` } })).toBeNull();
  });

  test("an unrelated legacy global feed cannot claim a company upload by external ID", async () => {
    const legacy = await db.importSource.create({ data: { name: `${suffix}-legacy-feed`, sourceType: "JSON" } });
    sourceIds.push(legacy.id);
    const result = await importRows(2, [record]);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    const imported = await db.importRecord.findFirstOrThrow({ where: { importRunId: result.runId, action: "CREATED" }, include: { property: true } });
    expect(imported.property?.ownerOrganizationId).toBeNull();
    expect(await db.property.count({ where: { sourceId: record.externalId, ownerOrganizationId: { in: orgIds } } })).toBe(2);
  });

  test("project mapping failures are visible in preview without creating parents", async () => {
    const summary = await importRows(0, [{ ...record, externalId: `${suffix}-invalid-project`, project: `Unmapped project ${suffix}` }], true);
    expect(summary.failed).toBe(1);
    expect(summary.wouldCreate).toBe(0);
    const outcome = await db.importRecord.findFirstOrThrow({ where: { importRunId: summary.runId } });
    expect(outcome.issuesJson).toContain("Developer mapping required");
    expect(await db.property.count({ where: { sourceId: `${suffix}-invalid-project` } })).toBe(0);
  });

  test("preview distinguishes valid drafts from publication prerequisites, including rental frequency", async () => {
    await db.community.update({ where: { id: communityId }, data: { publicationStatus: "PUBLISHED" } });
    const missingFrequency = await importRows(0, [{ ...record, externalId: `${suffix}-rental`, listingType: "RENT" }], true);
    const blocked = await db.importRecord.findFirstOrThrow({ where: { importRunId: missingFrequency.runId } });
    const blockedIssues = JSON.parse(blocked.issuesJson ?? "{}").publicationIssues as { field: string }[];
    expect(blockedIssues.some(issue => issue.field === "listingType")).toBe(true);
    const ready = await importRows(0, [{ ...record, externalId: `${suffix}-rental`, listingType: "RENT", rentFrequency: "YEARLY" }], true);
    const eligible = await db.importRecord.findFirstOrThrow({ where: { importRunId: ready.runId } });
    expect(JSON.parse(eligible.issuesJson ?? "{}").publicationIssues).toEqual([]);
    expect(await db.property.count({ where: { sourceId: `${suffix}-rental` } })).toBe(0);
    const committed = await importRows(0, [{ ...record, externalId: `${suffix}-rental`, listingType: "RENT", rentFrequency: "YEARLY" }]);
    expect(committed.created).toBe(1);
    const draft = await db.property.findFirstOrThrow({ where: { sourceId: `${suffix}-rental` }, include: { listings: true } });
    expect(draft.publicationStatus).toBe("DRAFT");
    expect(draft.listings[0].publishedAt).toBeNull();
    expect(draft.listings[0].rentFrequency).toBe("YEARLY");
  });

  test("another company's private community cannot be referenced by name", async () => {
    await db.community.update({ where: { id: communityId }, data: { ownerOrganizationId: orgIds[1] } });
    try {
      const preview = await importRows(0, [{ ...record, externalId: `${suffix}-foreign-community` }], true);
      expect(preview.failed).toBe(1);
      const issue = await db.importRecord.findFirstOrThrow({ where: { importRunId: preview.runId } });
      expect(issue.issuesJson).toContain("Unknown community");
    } finally { await db.community.update({ where: { id: communityId }, data: { ownerOrganizationId: null } }); }
  });

  test("repeated source IDs have matching preview/apply outcomes instead of silently merging conflicting rows", async () => {
    const first = { ...record, externalId: `${suffix}-repeated` };
    const rows = [first, first, { ...first, title: "Conflicting duplicate source fact" }];
    const preview = await importRows(0, rows, true);
    expect(preview.wouldCreate).toBe(1);
    expect(preview.skippedDuplicate).toBe(1);
    expect(preview.skippedInvalid).toBe(1);
    const apply = await importRows(0, rows);
    expect(apply.created).toBe(1);
    expect(apply.updated).toBe(0);
    expect(apply.skippedDuplicate).toBe(1);
    expect(apply.skippedInvalid).toBe(1);
    expect((await db.property.findFirstOrThrow({ where: { sourceId: first.externalId } })).title).toBe(first.title);
  });
});

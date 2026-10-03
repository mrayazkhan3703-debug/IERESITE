import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { mapOutboxEventToJob } from "@/server/jobs/outbox";
import { processStagedImport } from "@/server/ingestion/staged";
import { deletePrivateObject } from "@/server/storage/object-store";
import { companyImportSource } from "@/server/domain/import-scope";
import { createHash } from "node:crypto";
import { serializeColumnMapping, type ColumnMapping } from "@/server/ingestion/column-mapping";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  organization: `staged-import-org-${suffix}`,
  user: `staged-import-owner-${suffix}`,
  community: `staged-import-community-${suffix}`,
};
const idempotencyKey = `staged-import-request-${suffix}`;
const dryRunIdempotencyKey = `staged-import-dry-run-${suffix}`;
const unsupportedModeKey = `staged-import-mode-${suffix}`;
const partialIdempotencyKey = `staged-import-partial-${suffix}`;
const limitIdempotencyKey = `staged-import-limit-${suffix}`;
const mappingIdempotencyKey = `staged-import-mapping-${suffix}`;
const externalId = `synthetic-staged-${suffix}`;
let ownerCookie = "";

async function postImport(csv: string, options: { idempotencyKey?: string; dryRun?: boolean; columnMapping?: ColumnMapping } = {}): Promise<Response> {
  const key = options.idempotencyKey ?? idempotencyKey;
  let previewRunId: string | undefined;
  if (!options.dryRun) {
    const preview = await postImport(csv, { idempotencyKey: `${key}-preview`, dryRun: true, columnMapping: options.columnMapping });
    if (preview.status !== 202) return preview;
    previewRunId = (await preview.json() as { importRunId: string }).importRunId;
    const reviewed = await waitForRun(previewRunId);
    expect(reviewed.status).toBe("DRY_RUN");
  }
  return fetch(`${baseUrl}/api/admin/imports`, {
    method: "POST",
    headers: {
      cookie: ownerCookie,
      "content-type": "application/json",
      "x-requested-with": "fetch",
      "idempotency-key": options.idempotencyKey ?? idempotencyKey,
    },
    body: JSON.stringify({ format: "csv", data: csv, dryRun: options.dryRun ?? false, previewRunId, columnMapping: options.columnMapping }),
  });
}

async function waitForRun(runId: string) {
  const deadline = Date.now() + 60_000;
  let run = await db.importRun.findUniqueOrThrow({ where: { id: runId } });
  while (["QUEUED", "RUNNING"].includes(run.status) && Date.now() < deadline) {
    await Bun.sleep(500);
    run = await db.importRun.findUniqueOrThrow({ where: { id: runId } });
  }
  return run;
}

beforeAll(async () => {
  await db.organization.create({ data: { id: ids.organization, name: "Staged import test organization", slug: `staged-import-${suffix}` } });
  const owner = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({
    data: {
      id: ids.user,
      email: `staged-import-${suffix}@example.invalid`,
      emailVerified: new Date(),
      roles: { create: { roleId: owner.id } },
    },
  });
  await db.community.create({
    data: {
      id: ids.community,
      name: `Synthetic Staged Import Community ${suffix}`,
      slug: `synthetic-staged-import-${suffix}`,
      areaType: "WATERFRONT",
      lat: 25.08,
      lng: 55.14,
      publicationStatus: "PUBLISHED",
    },
  });
  ownerCookie = `ie_session=${await createSession(ids.user, { mfaVerified: true })}`;
});

afterAll(async () => {
  const keys = [idempotencyKey, dryRunIdempotencyKey, unsupportedModeKey, partialIdempotencyKey, limitIdempotencyKey, mappingIdempotencyKey];
  const runs = await db.importRun.findMany({ where: { idempotencyKey: { in: keys.flatMap(key => [key, `${key}-preview`]) } }, select: { id: true, snapshotRef: true } });
  const runIds = runs.map((run) => run.id);
  const records = runIds.length ? await db.importRecord.findMany({ where: { importRunId: { in: runIds } }, select: { propertyId: true, listingId: true } }) : [];
  const propertyIds = [...new Set(records.flatMap((record) => record.propertyId ? [record.propertyId] : []))];
  const listings = propertyIds.length ? await db.listing.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true } }) : [];
  const listingIds = [...new Set([...records.flatMap((record) => record.listingId ? [record.listingId] : []), ...listings.map((listing) => listing.id)])];
  const eventAggregateIds = [...runIds, ...propertyIds];
  const events = eventAggregateIds.length ? await db.outboxEvent.findMany({ where: { aggregateId: { in: eventAggregateIds } }, select: { id: true } }) : [];
  const jobKeys = [
    ...runIds.map((runId) => `import:${runId}:process`),
    ...events.map((event) => `outbox:${event.id}:search.index.property`),
  ];
  if (jobKeys.length) {
    const jobs = await db.jobRun.findMany({ where: { idempotencyKey: { in: jobKeys } }, select: { id: true } });
    await db.deadLetterEvent.deleteMany({ where: { sourceId: { in: jobs.map((job) => job.id) } } });
    await db.jobRun.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
  }
  if (runIds.length) {
    await db.auditLog.deleteMany({ where: { resourceType: "import_run", resourceId: { in: runIds } } });
    await db.importRecord.deleteMany({ where: { importRunId: { in: runIds } } });
    await db.importRunChunk.deleteMany({ where: { importRunId: { in: runIds } } });
  }
  if (events.length) await db.outboxEvent.deleteMany({ where: { id: { in: events.map((event) => event.id) } } });
  if (propertyIds.length) {
    await db.dataQualityIssue.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await db.priceHistory.deleteMany({ where: { propertyId: { in: propertyIds } } });
  }
  if (listingIds.length) await db.listingStatusHistory.deleteMany({ where: { listingId: { in: listingIds } } });
  if (propertyIds.length) await db.listing.deleteMany({ where: { propertyId: { in: propertyIds } } });
  if (propertyIds.length) await db.property.deleteMany({ where: { id: { in: propertyIds } } });
  if (runIds.length) await db.importRun.deleteMany({ where: { id: { in: runIds } } });
  await db.importSource.deleteMany({ where: { name: companyImportSource({ id: ids.user, email: "", sessionId: "", name: null, roles: ["OWNER"], organizationId: null, permissions: [], mfaVerified: true }).name } });
  await db.session.deleteMany({ where: { userId: ids.user } });
  await db.user.deleteMany({ where: { id: ids.user } });
  await db.community.deleteMany({ where: { id: ids.community } });
  await db.organization.deleteMany({ where: { id: ids.organization } });
  await Promise.all(runs.flatMap((run) => run.snapshotRef ? [deletePrivateObject(run.snapshotRef).catch(() => {})] : []));
  await db.$disconnect();
});

describe("staged Admin import path", () => {
  test("mapped source bytes stay immutable and changed mappings require a new preview", async () => {
    const sourceId = `000-${suffix}`;
    const csv = `Reference,Name,District,Asking,Other price\n${sourceId},Synthetic mapped fixture,Synthetic Staged Import Community ${suffix},1100000,1200000\n`;
    const columnMapping = { externalId: "Reference", title: "Name", community: "District", priceAed: "Asking" };
    const response = await postImport(csv, { idempotencyKey: `${mappingIdempotencyKey}-preview`, dryRun: true, columnMapping });
    expect(response.status).toBe(202);
    const { importRunId } = await response.json() as { importRunId: string };
    const preview = await waitForRun(importRunId);
    expect(preview.status).toBe("DRY_RUN");
    expect(preview.snapshotSha256).toBe(createHash("sha256").update(csv).digest("hex"));
    expect(preview.mappingJson).toBe(serializeColumnMapping(columnMapping));
    expect(preview.adapterKey).toBe("iere.mapped-property-csv");
    expect(await db.property.findFirst({ where: { sourceId } })).toBeNull();
    const commit = async (mapping: ColumnMapping) => fetch(`${baseUrl}/api/admin/imports`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "x-requested-with": "fetch", "idempotency-key": mappingIdempotencyKey },
      body: JSON.stringify({ format: "csv", data: csv, dryRun: false, previewRunId: importRunId, columnMapping: mapping }),
    });
    expect((await commit({ ...columnMapping, priceAed: "Other price" })).status).toBe(409);
    expect(await db.importRun.findUnique({ where: { idempotencyKey: mappingIdempotencyKey } })).toBeNull();
    const committed = await commit(columnMapping);
    expect(committed.status).toBe(202);
    const applied = await committed.json() as { importRunId: string };
    expect((await waitForRun(applied.importRunId)).status).toBe("SUCCEEDED");
    const property = await db.property.findFirstOrThrow({ where: { sourceId }, include: { listings: true } });
    expect(property.publicationStatus).toBe("DRAFT");
    expect(String(property.listings[0].priceMinor)).toBe("110000000");
    const replay = await commit(columnMapping);
    expect((await replay.json() as { importRunId: string }).importRunId).toBe(applied.importRunId);
    expect(await db.property.count({ where: { sourceId } })).toBe(1);
  }, 60_000);
  test("refuses an apply request without a durable preview", async () => {
    const response = await fetch(`${baseUrl}/api/admin/imports`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json", "x-requested-with": "fetch", "idempotency-key": `unreviewed-${suffix}` },
      body: JSON.stringify({ format: "json", dryRun: false, data: [{ externalId: "unreviewed", title: "Unreviewed fixture", community: "Unknown community", priceAed: 1 }] }),
    });
    expect(response.status).toBe(409);
    expect(await db.importRun.findUnique({ where: { idempotencyKey: `unreviewed-${suffix}` } })).toBeNull();
  });
  test("queues once by idempotency key, applies a durable chunk, and leaves imported inventory private", async () => {
    const csv = [
      "external_id,title,community,property_type,listing_type,bedrooms,bathrooms,price_aed,off_plan,availability,description,lat,lng",
      `${externalId},Synthetic Test Apartment,Synthetic Staged Import Community ${suffix},APARTMENT,SALE,2,2,1450000,false,AVAILABLE,Synthetic integration fixture,25.08,55.14`,
    ].join("\n");

    const fixtureCommunity = await db.community.findUniqueOrThrow({ where: { id: ids.community } });
    const matchingCommunity = await db.community.findFirst({ where: { name: { equals: fixtureCommunity.name, mode: "insensitive" } } });
    expect(matchingCommunity?.id).toBe(ids.community);

    const malformed = await postImport(`${csv}\n\"unterminated`);
    expect(malformed.status).toBe(400);
    expect(await db.importRun.findUnique({ where: { idempotencyKey } })).toBeNull();
    const tooManyRows = Array.from({ length: 501 }, (_, index) => `${externalId}-${index},Synthetic Apartment ${index},Synthetic Staged Import Community ${suffix},APARTMENT,SALE,1,1,950000,false,AVAILABLE,Synthetic limit fixture,25.08,55.14`);
    const overLimit = await postImport([csv.split("\n")[0], ...tooManyRows].join("\n"), { idempotencyKey: limitIdempotencyKey });
    expect(overLimit.status).toBe(400);
    expect(await db.importRun.findUnique({ where: { idempotencyKey: limitIdempotencyKey } })).toBeNull();

    const response = await postImport(csv);
    expect(response.status).toBe(202);
    const queued = await response.json() as { importRunId: string; status: string; duplicateRequest: boolean };
    expect(queued.status).toBe("QUEUED");
    expect(queued.duplicateRequest).toBe(false);

    const duplicate = await postImport(csv);
    expect(duplicate.status).toBe(202);
    const repeated = await duplicate.json() as typeof queued;
    expect(repeated.importRunId).toBe(queued.importRunId);
    expect(repeated.duplicateRequest).toBe(true);
    const conflict = await postImport(csv.replace(externalId, `${externalId}-conflict`));
    expect(conflict.status).toBe(409);
    expect(await db.importRun.count({ where: { idempotencyKey } })).toBe(1);

    const event = await db.outboxEvent.findFirstOrThrow({ where: { eventType: "import.staged.requested", aggregateId: queued.importRunId } });
    expect(mapOutboxEventToJob(event.id, event.eventType, event.aggregateType, event.aggregateId, {})).toEqual({
      key: "ingestion.import.process",
      payload: { importRunId: queued.importRunId },
      idempotencyKey: `import:${queued.importRunId}:process`,
    });
    expect(await db.auditLog.count({ where: { action: "import.stage", resourceType: "import_run", resourceId: queued.importRunId } })).toBe(1);

    const completed = await waitForRun(queued.importRunId);
    if (completed.status !== "SUCCEEDED") {
      const failedRecords = await db.importRecord.findMany({ where: { importRunId: queued.importRunId }, select: { action: true, issuesJson: true } });
      throw new Error(JSON.stringify({ status: completed.status, error: completed.error, failedRecords }));
    }
    expect(completed.recordsTotal).toBe(1);
    expect(completed.recordsCreated).toBe(1);
    expect(completed.recordCursor).toBe(1);
    const job = await db.jobRun.findUniqueOrThrow({ where: { idempotencyKey: `import:${queued.importRunId}:process` } });
    expect(job.status).toBe("SUCCEEDED");

    const historyResponse = await fetch(`${baseUrl}/api/admin/imports`, { headers: { cookie: ownerCookie, "x-requested-with": "fetch" } });
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as { runs: Record<string, unknown>[] };
    const historyRun = history.runs.find((run) => run.id === queued.importRunId);
    expect(historyRun?.createdAt).toBeDefined();
    expect(historyRun).not.toHaveProperty("snapshotRef");

    const [chunk, record, property] = await Promise.all([
      db.importRunChunk.findUniqueOrThrow({ where: { importRunId_chunkNumber: { importRunId: queued.importRunId, chunkNumber: 1 } } }),
      db.importRecord.findUniqueOrThrow({ where: { importRunId_recordNumber: { importRunId: queued.importRunId, recordNumber: 1 } } }),
      db.property.findFirstOrThrow({ where: { sourceId: externalId, sourceType: "IMPORT" } }),
    ]);
    expect(chunk.status).toBe("SUCCEEDED");
    expect(chunk.recordsCount).toBe(1);
    expect(record.action).toBe("CREATED");
    expect(record.importRunChunkId).toBe(chunk.id);
    expect(property.publicationStatus).toBe("DRAFT");
    const listing = await db.listing.findFirstOrThrow({ where: { propertyId: property.id } });
    expect(listing.publishedAt).toBeNull();
  }, 60_000);

  test("dry-run is processed by the worker without creating or publishing inventory", async () => {
    const dryExternalId = `synthetic-dry-run-${suffix}`;
    const csv = [
      "external_id,title,community,property_type,listing_type,bedrooms,bathrooms,price_aed,off_plan,availability,description,lat,lng",
      `${dryExternalId},Synthetic Dry Run Apartment,Synthetic Staged Import Community ${suffix},APARTMENT,SALE,1,1,950000,false,AVAILABLE,Synthetic dry-run fixture,25.08,55.14`,
    ].join("\n");
    const response = await postImport(csv, { idempotencyKey: dryRunIdempotencyKey, dryRun: true });
    expect(response.status).toBe(202);
    const queued = await response.json() as { importRunId: string; status: string };
    const completed = await waitForRun(queued.importRunId);
    expect(completed.status).toBe("DRY_RUN");
    expect(completed.recordsTotal).toBe(1);
    expect(completed.recordsCreated).toBe(0);
    const record = await db.importRecord.findUniqueOrThrow({ where: { importRunId_recordNumber: { importRunId: queued.importRunId, recordNumber: 1 } } });
    expect(record.action).toBe("DRY_RUN");
    expect(await db.property.findFirst({ where: { sourceId: dryExternalId, sourceType: "IMPORT" } })).toBeNull();
  }, 60_000);

  test("unimplemented source modes fail closed without applying records", async () => {
    const source = await db.importSource.findUniqueOrThrow({ where: { name: companyImportSource({ id: ids.user, email: "", sessionId: "", name: null, roles: ["OWNER"], organizationId: null, permissions: [], mfaVerified: true }).name } });
    const run = await db.importRun.create({ data: { importSourceId: source.id, idempotencyKey: unsupportedModeKey, importMode: "INCREMENTAL", status: "QUEUED" } });
    await processStagedImport(run.id);
    const failed = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("no records were changed");
    expect(await db.importRecord.count({ where: { importRunId: run.id } })).toBe(0);
  }, 60_000);

  test("failed reference rows are inspectable without returning raw provider payloads", async () => {
    const csv = [
      "external_id,title,community,property_type,listing_type,bedrooms,bathrooms,price_aed,off_plan,availability,description,lat,lng",
      `synthetic-unresolved-${suffix},Synthetic Unresolved Apartment,Unmapped Synthetic Community ${suffix},APARTMENT,SALE,1,1,850000,false,AVAILABLE,Synthetic unresolved fixture,25.08,55.14`,
    ].join("\n");
    const response = await postImport(csv, { idempotencyKey: partialIdempotencyKey });
    expect(response.status).toBe(202);
    const queued = await response.json() as { importRunId: string };
    const completed = await waitForRun(queued.importRunId);
    expect(completed.status).toBe("PARTIAL");
    expect(completed.recordsFailed).toBe(1);
    const detailsResponse = await fetch(`${baseUrl}/api/admin/imports/${encodeURIComponent(queued.importRunId)}`, { headers: { cookie: ownerCookie, "x-requested-with": "fetch" } });
    expect(detailsResponse.status).toBe(200);
    const details = await detailsResponse.json() as { records: Record<string, unknown>[] };
    expect(details.records).toHaveLength(1);
    expect(details.records[0]?.action).toBe("FAILED");
    const issues = details.records[0]?.issues as { field: string | null; message: string }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("Unknown community");
    expect(details.records[0]).not.toHaveProperty("rawJson");
    expect(details.records[0]).not.toHaveProperty("externalKey");
  }, 60_000);
});

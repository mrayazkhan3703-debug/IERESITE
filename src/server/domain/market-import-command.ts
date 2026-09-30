import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { marketSourceSchema, marketSourceConfig, mapMarketRow, marketRowSchema, marketMinor, marketFreshness, type MarketSourceInput, type MarketRow } from "@/lib/market-import";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { parseMarketFile } from "@/server/ingestion/market-file";
import { persistImportSnapshot } from "@/server/ingestion/snapshot";

function requireManager(actor: SessionUser) {
  if (!actor.roles.some((r) => ["OWNER", "ADMIN"].includes(r))) throw new HttpError(403, "Owner or Admin access is required.", "MARKET_IMPORT_FORBIDDEN");
}
const serialize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(serialize(value))).digest("hex");
const transactionOpts = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 } as const;
function recordData(row: MarketRow, source: MarketSourceInput, communityId: string | null, runId: string, key: string) {
  const shared = { source: source.name, sourceRecordKey: key, areaName: row.areaName, communityId, propertyType: row.propertyType, currency: "AED", sizeSqft: row.sizeSqft ?? null, isIllustrative: source.isIllustrative, importRunId: runId, rawPayloadJson: JSON.stringify(row) };
  return source.datasetKind === "MARKET_TRANSACTION"
    ? { ...shared, transactionDate: new Date(row.date), amountMinor: marketMinor(row.amountAed), pricePerSqftMinor: row.sizeSqft ? marketMinor(row.amountAed / row.sizeSqft) : null, transactionType: row.transactionType, projectName: row.projectName || null }
    : { ...shared, contractDate: new Date(row.date), annualRentMinor: marketMinor(row.amountAed), bedrooms: row.bedrooms ?? null };
}
export async function saveMarketSource(actor: SessionUser, input: MarketSourceInput, id: string | undefined, expectedUpdatedAt: string | undefined, ip: string | null) {
  requireManager(actor);
  const value = marketSourceSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.importSource.findUnique({ where: { id } }) : null;
    if (id && (!before || !marketSourceConfig(before.configJson))) throw new HttpError(404, "Market source not found.");
    if (before && before.updatedAt.toISOString() !== expectedUpdatedAt) throw new HttpError(409, "Source changed. Reload before editing.", "VERSION_CONFLICT");
    const data = { name: value.name, url: value.url, notes: value.notes, isActive: value.isActive, sourceType: "MARKET_UPLOAD", configJson: JSON.stringify(value) };
    const source = before ? await tx.importSource.update({ where: { id: before.id }, data }) : await tx.importSource.create({ data });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "market.source.save", resourceType: "import_source", resourceId: source.id, before, after: data, ip }, tx);
    return source;
  }, transactionOpts);
}
export async function validateMarketImport(actor: SessionUser, input: { sourceId: string; format: "CSV" | "JSON"; data: string; retrievedAt: string; idempotencyKey: string }, ip: string | null) {
  requireManager(actor);
  const rawRows = parseMarketFile(input.data, input.format);
  const sourceRecord = await db.importSource.findUnique({ where: { id: input.sourceId } });
  const source = marketSourceConfig(sourceRecord?.configJson ?? null);
  if (!sourceRecord?.isActive || !source) throw new HttpError(422, "Choose an active market source.");
  const retrievedAt = new Date(input.retrievedAt);
  if (!Number.isFinite(retrievedAt.getTime()) || retrievedAt.getTime() > Date.now() || marketFreshness(retrievedAt, source.staleAfterDays) !== "CURRENT") throw new HttpError(422, "Use a current retrieval date within the source freshness window.", "MARKET_SOURCE_STALE");
  const requestHash = digest({ data: input.data, format: input.format, sourceId: input.sourceId, sourceVersion: sourceRecord.updatedAt.toISOString(), retrievedAt: input.retrievedAt });
  const prior = await db.importRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.adapterKey !== "market-upload-v1" || prior.sourceVersion !== requestHash) throw new HttpError(409, "Request key was used for a different upload.", "IMPORT_IDEMPOTENCY_CONFLICT");
    return { importRunId: prior.id, status: prior.status, duplicateRequest: true };
  }
  const snapshot = await persistImportSnapshot({ sourceKey: sourceRecord.id, format: input.format, bytes: new TextEncoder().encode(input.data) });
  return db.$transaction(async (tx) => {
    const currentSource = await tx.importSource.findUniqueOrThrow({ where: { id: sourceRecord.id } });
    if (currentSource.updatedAt.getTime() !== sourceRecord.updatedAt.getTime()) throw new HttpError(409, "Source changed during validation. Upload again.");
    const run = await tx.importRun.create({ data: {
      importSourceId: sourceRecord.id, datasetKind: source.datasetKind, status: "VALIDATED", dryRun: true, inputFormat: input.format,
      idempotencyKey: input.idempotencyKey, adapterKey: "market-upload-v1", adapterVersion: 1, sourceVersion: requestHash,
      snapshotSha256: snapshot.sha256, snapshotRef: snapshot.storageRef, snapshotRetrievedAt: retrievedAt,
      triggeredBy: actor.email, recordsTotal: rawRows.length, startedAt: new Date(), finishedAt: new Date(),
    } });
    const seen = new Set<string>();
    let rejected = 0, duplicates = 0;
    for (const [i, raw] of rawRows.entries()) {
      const parsed = marketRowSchema.safeParse(mapMarketRow(raw, source.mapping));
      const errors = parsed.success ? [] : parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      const row = parsed.success ? parsed.data : null;
      if (row && source.datasetKind === "MARKET_RENT" && row.bedrooms === 0 && row.propertyType.toUpperCase() !== "STUDIO") errors.push("Zero bedrooms requires STUDIO property type.");
      const community = row?.communitySlug ? await tx.community.findUnique({ where: { slug: row.communitySlug }, select: { id: true } }) : null;
      if (row?.communitySlug && !community) errors.push("Unknown community slug.");
      const externalKey = row ? `${sourceRecord.id}:${row.externalId}` : null;
      if (externalKey && seen.has(externalKey)) errors.push("Duplicate external ID within this upload.");
      if (externalKey) seen.add(externalKey);
      if (!row || errors.length) {
        rejected++;
        await tx.importRecord.create({ data: { importRunId: run.id, recordNumber: i + 1, entityKind: source.datasetKind, externalKey, action: "SKIPPED_INVALID", rawJson: JSON.stringify(raw), issuesJson: JSON.stringify({ errors }) } });
        continue;
      }
      const previous = source.datasetKind === "MARKET_TRANSACTION" ? await tx.marketTransaction.findUnique({ where: { sourceRecordKey: externalKey! } }) : await tx.marketRent.findUnique({ where: { sourceRecordKey: externalKey! } });
      const next = recordData(row, source, community?.id ?? null, run.id, externalKey!);
      const before: Record<string, unknown> | null = previous ? { ...serialize(previous) as Record<string, unknown>, id: undefined, createdAt: undefined, importRunId: undefined } : null;
      const after: Record<string, unknown> = { ...serialize(next) as Record<string, unknown>, importRunId: undefined };
      const unchanged = before && Object.keys(after).every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
      if (unchanged) duplicates++;
      await tx.importRecord.create({ data: {
        importRunId: run.id, recordNumber: i + 1, entityKind: source.datasetKind, externalKey,
        action: unchanged ? "SKIPPED_DUPLICATE" : "DRY_RUN", checksum: digest(previous ?? null),
        rawJson: JSON.stringify({ row, communityId: community?.id ?? null, source, sourceUpdatedAt: sourceRecord.updatedAt.toISOString() }),
        issuesJson: JSON.stringify({ plannedAction: unchanged ? "UNCHANGED" : previous ? "UPDATE" : "CREATE", before, after, warnings: row.sizeSqft ? [] : ["No size: excluded from price-per-square-foot metrics."] }),
      } });
    }
    const status = rejected ? "NEEDS_REVIEW" : "VALIDATED";
    await tx.importRun.update({ where: { id: run.id }, data: { status, recordsFailed: rejected, recordsSkipped: duplicates, duplicatesDetected: duplicates } });
    if (rejected) await tx.dataQualityIssue.create({ data: { entityKind: source.datasetKind, entityId: run.id, severity: "ERROR", ruleKey: "market_import_rejected", message: `${rejected} rejected records in import ${run.id}; no market rows applied.` } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "market.import.validate", resourceType: "import_run", resourceId: run.id, before: null, after: { status, total: rawRows.length, rejected, duplicates, sha256: snapshot.sha256 }, ip }, tx);
    return { importRunId: run.id, status, duplicateRequest: false };
  }, transactionOpts);
}
export async function applyMarketImport(actor: SessionUser, runId: string, expectedSha256: string, ip: string | null) {
  requireManager(actor);
  return db.$transaction(async (tx) => {
    const run = await tx.importRun.findUnique({ where: { id: runId }, include: { records: { orderBy: { recordNumber: "asc" } }, importSource: true } });
    if (!run?.datasetKind || run.adapterKey !== "market-upload-v1") throw new HttpError(404, "Market import not found.");
    if (run.snapshotSha256 !== expectedSha256) throw new HttpError(409, "Upload checksum does not match.");
    if (run.appliedAt) return { importRunId: run.id, status: run.status, duplicateRequest: true };
    if (run.status !== "VALIDATED" || run.recordsFailed > 0) throw new HttpError(409, "Resolve rejected rows and validate a new upload before applying.", "MARKET_IMPORT_REJECTED");
    const source = marketSourceConfig(run.importSource.configJson);
    if (!run.importSource.isActive || !source || marketFreshness(run.snapshotRetrievedAt, source.staleAfterDays) !== "CURRENT") throw new HttpError(409, "Source is inactive or stale. Validate a current upload.");
    let created = 0, updated = 0;
    for (const record of run.records) {
      const saved = JSON.parse(record.rawJson!) as { row: MarketRow; communityId: string | null; source: MarketSourceInput; sourceUpdatedAt: string };
      if (saved.sourceUpdatedAt !== run.importSource.updatedAt.toISOString()) throw new HttpError(409, "Source mapping changed. Validate again.", "MARKET_SOURCE_CHANGED");
      const previous = run.datasetKind === "MARKET_TRANSACTION" ? await tx.marketTransaction.findUnique({ where: { sourceRecordKey: record.externalKey! } }) : await tx.marketRent.findUnique({ where: { sourceRecordKey: record.externalKey! } });
      if (digest(previous ?? null) !== record.checksum) throw new HttpError(409, "Market rows changed since validation. Validate again.", "MARKET_DIFF_CONFLICT");
      if (record.action === "SKIPPED_DUPLICATE") continue;
      const data = recordData(marketRowSchema.parse(saved.row), saved.source, saved.communityId, run.id, record.externalKey!);
      if (run.datasetKind === "MARKET_TRANSACTION") {
        const value = data as Prisma.MarketTransactionUncheckedCreateInput;
        await tx.marketTransaction.upsert({ where: { sourceRecordKey: record.externalKey! }, create: value, update: value });
      } else {
        const value = data as Prisma.MarketRentUncheckedCreateInput;
        await tx.marketRent.upsert({ where: { sourceRecordKey: record.externalKey! }, create: value, update: value });
      }
      if (previous) updated++; else created++;
      await tx.importRecord.update({ where: { id: record.id }, data: { action: previous ? "UPDATED" : "CREATED" } });
    }
    await tx.importRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", dryRun: false, recordsCreated: created, recordsUpdated: updated, appliedAt: new Date(), appliedBy: actor.id, finishedAt: new Date() } });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "market.import.apply", resourceType: "import_run", resourceId: run.id, before: { status: run.status }, after: { status: "SUCCEEDED", created, updated, sha256: run.snapshotSha256, sourceName: source.name }, ip }, tx);
    return { importRunId: run.id, status: "SUCCEEDED", created, updated, duplicateRequest: false };
  }, transactionOpts);
}

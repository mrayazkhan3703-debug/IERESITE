import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { HttpError, requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { db } from "@/lib/db";
import { JsonParseError, getCanonicalAdapterForFormat } from "@/server/ingestion/adapters";
import { CsvParseError } from "@/server/ingestion/csv";
import { Readable } from "node:stream";
import { MAX_IMPORT_SNAPSHOT_BYTES, persistImportSnapshot } from "@/server/ingestion/snapshot";
import { deletePrivateObject } from "@/server/storage/object-store";
import { stageImportCommand } from "@/server/domain/import-command";

export const dynamic = "force-dynamic";

/** Import runs history + data-quality issues (Q07) */
export const GET = apiHandler(async () => {
  await requirePermission("import:read");
  const [runs, quality] = await Promise.all([
    db.importRun.findMany({ where: { datasetKind: null }, orderBy: { createdAt: "desc" }, take: 10, include: { importSource: { select: { name: true } } } }),
    db.dataQualityIssue.findMany({ where: { status: "OPEN" }, orderBy: { detectedAt: "desc" }, take: 30, include: { property: { select: { title: true, slug: true } } } }),
  ]);
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      source: r.importSource.name,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      recordsTotal: r.recordsTotal,
      recordsCreated: r.recordsCreated,
      recordsUpdated: r.recordsUpdated,
      recordsSkipped: r.recordsSkipped,
      recordsFailed: r.recordsFailed,
      duplicatesDetected: r.duplicatesDetected,
      triggeredBy: r.triggeredBy,
    })),
    qualityIssues: quality.map((q) => ({
      id: q.id,
      severity: q.severity,
      ruleKey: q.ruleKey,
      message: q.message,
      property: q.property ? { title: q.property.title, slug: q.property.slug } : null,
      detectedAt: q.detectedAt.toISOString(),
    })),
  });
});

const postSchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  data: z.union([z.string(), z.array(z.unknown())]),
  dryRun: z.boolean().default(false),
});

/** Run an import from posted JSON array or CSV text (Q07 golden path: admin → ingestion → index → public) */
export const POST = apiHandler(async (req) => {
  const user = await requirePermission("import:*");
  const raw = await jsonBody<z.infer<typeof postSchema>>(req);
  const input = postSchema.parse(raw);
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) throw new HttpError(400, "An Idempotency-Key header is required.", "IMPORT_IDEMPOTENCY_KEY_REQUIRED");

  let bytes: Uint8Array;
  if (input.format === "csv") {
    if (typeof input.data !== "string") throw new HttpError(400, "CSV imports require CSV text.", "CSV_INPUT_INVALID");
    bytes = new TextEncoder().encode(input.data);
  } else {
    if (!Array.isArray(input.data)) throw new HttpError(400, "JSON imports require an array of records.", "JSON_INPUT_INVALID");
    if (input.data.length > 500) throw new HttpError(400, "Interactive JSON imports are limited to 500 records.", "IMPORT_RECORD_LIMIT");
    bytes = new TextEncoder().encode(JSON.stringify(input.data));
  }
  if (bytes.byteLength > MAX_IMPORT_SNAPSHOT_BYTES) {
    throw new HttpError(413, "Interactive import snapshots are limited to 50 MiB.", "IMPORT_SNAPSHOT_LIMIT");
  }

  const format = input.format.toUpperCase() as "CSV" | "JSON";
  const adapter = getCanonicalAdapterForFormat(format);
  try {
    let count = 0;
    for await (const rawRecord of adapter.parse(Readable.from([bytes]))) {
      count += 1;
      if (count > 500) throw new HttpError(400, "Interactive imports are limited to 500 records.", "IMPORT_RECORD_LIMIT");
      adapter.validate(adapter.normalize(rawRecord));
    }
    if (count === 0) throw new HttpError(400, "No records to import.", "IMPORT_EMPTY");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof CsvParseError || error instanceof JsonParseError) {
      throw new HttpError(400, error.message, input.format === "csv" ? "CSV_PARSE_FAILED" : "JSON_PARSE_FAILED");
    }
    throw error;
  }

  const snapshot = await persistImportSnapshot({ sourceKey: "INTERACTIVE_UPLOAD", format, bytes });
  try {
    const staged = await stageImportCommand(user, { snapshot, idempotencyKey, dryRun: input.dryRun }, clientIp(req));
    return NextResponse.json(staged, { status: 202 });
  } catch (error) {
    const referenced = await db.importRun.findFirst({ where: { snapshotRef: snapshot.storageRef }, select: { id: true } });
    if (!referenced) await deletePrivateObject(snapshot.storageRef).catch(() => {});
    throw error;
  }
});

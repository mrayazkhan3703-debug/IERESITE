import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission, HttpError } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { marketFreshness, marketSourceConfig, marketSourceSchema } from "@/lib/market-import";
import { parseMarketFile, MARKET_FILE_BYTES } from "@/server/ingestion/market-file";
import { saveMarketSource, validateMarketImport, applyMarketImport } from "@/server/domain/market-import-command";
import { rebuildMarketMetrics } from "@/server/domain/market-metrics-command";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  await requirePermission("import:read");
  const runId = new URL(req.url).searchParams.get("run");
  if (runId) {
    const run = await db.importRun.findUnique({ where: { id: runId }, include: { records: { orderBy: { recordNumber: "asc" }, take: 500 }, importSource: true } });
    if (!run?.datasetKind) throw new HttpError(404, "Market run not found.");
    return NextResponse.json({ run: { ...run, snapshotRef: undefined, importSource: { id: run.importSource.id, name: run.importSource.name }, records: run.records.map((r) => ({ id: r.id, row: r.recordNumber, action: r.action, key: r.externalKey, details: JSON.parse(r.issuesJson ?? "{}") })) } });
  }
  const [sources, runs, metricCount] = await Promise.all([
    db.importSource.findMany({ where: { sourceType: "MARKET_UPLOAD" }, orderBy: { name: "asc" }, take: 100, include: { runs: { where: { appliedAt: { not: null } }, orderBy: { appliedAt: "desc" }, take: 1, select: { snapshotRetrievedAt: true, appliedAt: true } } } }),
    db.importRun.findMany({ where: { datasetKind: { not: null } }, orderBy: { createdAt: "desc" }, take: 30, include: { importSource: { select: { name: true } } } }),
    db.marketMetric.count(),
  ]);
  return NextResponse.json({ sources: sources.map((s) => ({ ...s, config: marketSourceConfig(s.configJson), configJson: undefined, freshness: marketFreshness(s.runs[0]?.snapshotRetrievedAt ?? null, marketSourceConfig(s.configJson)?.staleAfterDays) })), runs: runs.map((r) => ({ ...r, snapshotRef: undefined, source: r.importSource.name })), metricCount });
});
const file = z.object({ format: z.enum(["CSV", "JSON"]), data: z.string().min(1).max(MARKET_FILE_BYTES) });
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("source"), source: marketSourceSchema, id: z.string().optional(), expectedUpdatedAt: z.string().datetime().optional() }),
  file.extend({ action: z.literal("inspect") }),
  file.extend({ action: z.literal("validate"), sourceId: z.string().min(1), retrievedAt: z.string().datetime(), idempotencyKey: z.string().min(8).max(128) }),
  z.object({ action: z.literal("apply"), runId: z.string().min(1), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), confirmSourceReviewed: z.literal(true) }),
  z.object({ action: z.literal("rebuild") }),
]);
export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("import:*");
  const input = schema.parse(await jsonBody(req));
  const ip = clientIp(req);
  if (input.action === "inspect") {
    const rows = parseMarketFile(input.data, input.format);
    return NextResponse.json({ headers: [...new Set(rows.flatMap((r) => Object.keys(r)))], total: rows.length, preview: rows.slice(0, 3) });
  }
  try {
    if (input.action === "source") return NextResponse.json(await saveMarketSource(actor, input.source, input.id, input.expectedUpdatedAt, ip));
    if (input.action === "validate") return NextResponse.json(await validateMarketImport(actor, input, ip));
    if (input.action === "apply") return NextResponse.json(await applyMarketImport(actor, input.runId, input.expectedSha256, ip));
    return NextResponse.json(await rebuildMarketMetrics(actor, ip));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(e.code)) throw new HttpError(409, "Source name or request key already exists, or data changed concurrently. Refresh and retry with the same request key.", "MARKET_WRITE_CONFLICT");
    throw e;
  }
}, { rateLimit: { key: "market-data-write", limit: 20, windowMs: 60_000 } });

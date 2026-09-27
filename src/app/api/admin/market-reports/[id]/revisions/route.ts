import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { rollbackMarketReport } from "@/server/domain/market-report-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("content:read");
  const { id } = await ctx.params;
  const report = await db.marketReport.findUnique({ where: { id }, select: { id: true } });
  if (!report) return NextResponse.json({ error: "Market report not found." }, { status: 404 });
  const revisions = await db.marketReportRevision.findMany({ where: { marketReportId: id }, orderBy: { version: "desc" }, take: 50 });
  return NextResponse.json({ revisions: revisions.map((revision) => {
    let snapshot: unknown = null;
    try { snapshot = JSON.parse(revision.snapshotJson); } catch { /* corrupted historical snapshot remains non-restorable */ }
    return { id: revision.id, version: revision.version, editedBy: revision.editedBy, changeNote: revision.changeNote, createdAt: revision.createdAt.toISOString(), snapshot };
  }) });
});

const restoreSchema = z.object({ revisionId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = restoreSchema.parse(await jsonBody<z.infer<typeof restoreSchema>>(req));
  return NextResponse.json(await rollbackMarketReport(actor, id, input.revisionId, input.expectedUpdatedAt, clientIp(req)));
});

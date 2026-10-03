import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { HttpError, requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { importRunReadFilter } from "@/server/domain/import-scope";

export const dynamic = "force-dynamic";

function summarizeIssues(value: string | null): { field: string | null; message: string }[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 5).flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const item = issue as Record<string, unknown>;
        return typeof item.message === "string"
          ? [{ field: typeof item.path === "string" ? item.path.slice(0, 100) : null, message: item.message.slice(0, 300) }]
          : [];
      });
    }
    if (parsed && typeof parsed === "object" && "plannedAction" in parsed) {
      const action = (parsed as { plannedAction?: unknown }).plannedAction;
      if (action === "CREATE" || action === "UPDATE") {
        const publicationIssues = "publicationIssues" in parsed && Array.isArray(parsed.publicationIssues) ? parsed.publicationIssues.slice(0, 8).flatMap((issue: unknown) => {
          if (!issue || typeof issue !== "object") return [];
          const item = issue as Record<string, unknown>;
          return typeof item.message === "string" ? [{ field: typeof item.field === "string" ? item.field.slice(0, 100) : null, message: `Before publishing: ${item.message.slice(0, 300)}` }] : [];
        }) : [];
        return [{ field: null, message: `Would ${action.toLowerCase()} this property. Imports do not publish records or verify source facts.` }, ...publicationIssues];
      }
    }
  } catch {
    return [{ field: null, message: "Issue details are unavailable." }];
  }
  return [];
}

/** Bounded, permission-gated outcome detail; raw provider records stay private. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("import:read");
  const { id } = await ctx.params;
  if (!id || id.length > 128) throw new HttpError(400, "Invalid import run id.", "IMPORT_RUN_ID_INVALID");
  const run = await db.importRun.findFirst({
    where: { id, ...importRunReadFilter(actor) },
    select: { id: true, status: true, importMode: true, recordCursor: true, recordsTotal: true, recordsFailed: true },
  });
  if (!run) throw new HttpError(404, "Import run not found.", "IMPORT_RUN_NOT_FOUND");
  const records = await db.importRecord.findMany({
    where: { importRunId: id, recordNumber: { not: null } },
    orderBy: { recordNumber: "asc" },
    take: 500,
    select: { recordNumber: true, entityKind: true, action: true, issuesJson: true },
  });
  return NextResponse.json({
    run,
    records: records.map((record) => ({
      recordNumber: record.recordNumber,
      entityKind: record.entityKind,
      action: record.action,
      issues: summarizeIssues(record.issuesJson),
    })),
    truncated: records.length === 500 && run.recordsTotal > records.length,
  });
});

import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { getDataQualitySummary } from "@/server/domain/evidence";

export const dynamic = "force-dynamic";

/**
 * Admin Data Quality dashboard (V2 §39 "data quality"): runs the
 * validation pipeline (§19.5/§38) over a bounded stable scan with explicit coverage and reports
 * rents/transactions valid vs excluded rows with exclusion-reason
 * distribution, per-community per-sqft coverage, the canonical DQ rule
 * catalogue (read-only) and open ingestion quality issues.
 *
 * Read-only — validation is query-scoped governance; no records are
 * mutated. Permission domain: quality.
 */
export const GET = apiHandler(async () => {
  await requirePermission("quality:read");
  const summary = await getDataQualitySummary();
  return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } });
});

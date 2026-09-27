import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { getEvidenceOverview } from "@/server/domain/evidence";

export const dynamic = "force-dynamic";

/**
 * Admin Evidence / Provenance module (V2 §39 "evidence/provenance"):
 * per-domain record counts, provenance coverage (conditional count
 * aggregation), latest retrieval timestamps and the U09 data-state
 * distribution (resolveMetricState run server-side in batch).
 *
 * Read-only governance surface — permission domain: quality (ADMIN/OWNER,
 * ANALYST carries quality:read).
 */
export const GET = apiHandler(async () => {
  await requirePermission("quality:read");
  const overview = await getEvidenceOverview();
  return NextResponse.json(overview);
});

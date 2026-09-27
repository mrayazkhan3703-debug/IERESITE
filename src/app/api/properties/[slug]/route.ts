import { NextResponse } from "next/server";
import { getPropertyDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  // V2 (U06): additive detail projection — base shape + listingRef/updatedAt/listingUpdatedAt
  const detail = await getPropertyDetailV2(slug);
  if (!detail) {
    return NextResponse.json({ error: "Property not found", code: "NOT_FOUND" }, { status: 404 });
  }
  // recently-viewed essential telemetry (no PII)
  db.recentlyViewed.count().catch(() => {});
  return NextResponse.json(detail);
});

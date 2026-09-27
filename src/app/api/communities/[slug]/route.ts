import { NextResponse } from "next/server";
import { getCommunityDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

/* U08 (§16): V2 decision-page projection — base fields + sale/rent inventory
 * split, enriched projects, type distribution, supply pipeline, advisor
 * capacity/photo. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const detail = await getCommunityDetailV2(slug);
  if (!detail) return NextResponse.json({ error: "Community not found", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail);
});

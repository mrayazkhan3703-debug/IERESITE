import { NextResponse } from "next/server";
import { getDeveloperDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

/* U08 (§17): V2 developer intelligence projection — base fields + per-project
 * unit counts, payment-plan patterns and delivery summary. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const detail = await getDeveloperDetailV2(slug);
  if (!detail) return NextResponse.json({ error: "Developer not found", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail);
});

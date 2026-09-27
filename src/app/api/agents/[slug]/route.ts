import { NextResponse } from "next/server";
import { getAgentDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

/* U08 (§18): V2 advisor profile — base AgentDTO + listings + resolved photo. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const detail = await getAgentDetailV2(slug);
  if (!detail) return NextResponse.json({ error: "Advisor not found", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail);
});

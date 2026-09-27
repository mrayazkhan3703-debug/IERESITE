import { NextResponse } from "next/server";
import { getProjectDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

/* U07 (§15): V2 projection — byte-compatible base + unit inventory (tower/view/
 * linked-listing fields), advisor summaries for the panel. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const detail = await getProjectDetailV2(slug);
  if (!detail) {
    return NextResponse.json({ error: "Project not found", code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(detail);
});

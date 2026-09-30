import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { PUBLIC_CAREER_SELECT, publicCareerWhere } from "@/server/domain/career-query";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const locale = new URL(req.url).searchParams.get("locale") === "ar" ? "ar" : "en";
  const now = new Date();
  const opening = await db.careerOpening.findFirst({
    where: { slug, ...publicCareerWhere(locale, now) },
    select: PUBLIC_CAREER_SELECT,
  });
  if (!opening) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ opening: { ...opening, closesAt: opening.closesAt?.toISOString() ?? null, publishedAt: opening.publishedAt?.toISOString() ?? null } }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
});

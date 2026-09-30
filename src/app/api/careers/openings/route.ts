import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { PUBLIC_CAREER_SELECT, publicCareerWhere } from "@/server/domain/career-query";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "ar" ? "ar" : "en";
  const now = new Date();
  const openings = await db.careerOpening.findMany({
    where: publicCareerWhere(locale, now),
    orderBy: [{ publishedAt: "desc" }, { title: "asc" }],
    take: 50,
    select: PUBLIC_CAREER_SELECT,
  });
  return NextResponse.json({ openings: openings.map((opening) => ({ ...opening, closesAt: opening.closesAt?.toISOString() ?? null, publishedAt: opening.publishedAt?.toISOString() ?? null })) }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
});

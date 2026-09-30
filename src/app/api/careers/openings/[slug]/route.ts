import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const locale = new URL(req.url).searchParams.get("locale") === "ar" ? "ar" : "en";
  const now = new Date();
  const opening = await db.careerOpening.findFirst({
    where: { slug, locale, status: "PUBLISHED", publishedAt: { not: null, lte: now }, OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
    select: { slug: true, locale: true, title: true, department: true, location: true, employmentType: true, workplaceType: true, summary: true, description: true, closesAt: true, publishedAt: true },
  });
  if (!opening) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ opening: { ...opening, closesAt: opening.closesAt?.toISOString() ?? null, publishedAt: opening.publishedAt?.toISOString() ?? null } }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
});

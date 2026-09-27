import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { PUBLIC_TESTIMONIAL_WHERE, publicContentWhere } from "@/server/domain/visibility";
import { publicContentLocaleAlternates } from "@/server/seo/content-locale";
import { readContentBlocks } from "@/lib/content-blocks";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["guides", "articles", "insights", "faqs", "testimonials"]);

export const GET = apiHandler(async (req, ctx: { params: Promise<{ type: string }> }) => {
  const { type } = await ctx.params;
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "Unknown content type" }, { status: 404 });
  }

  if (type === "faqs") {
    const requestedLocale = new URL(req.url).searchParams.get("locale");
    const faqs = await db.faq.findMany({
      where: { isActive: true, ...(requestedLocale === "en" || requestedLocale === "ar" ? { locale: requestedLocale } : {}) },
      orderBy: [{ groupKey: "asc" }, { sortOrder: "asc" }],
    });
    return NextResponse.json({
      faqs: faqs.map((f) => ({ id: f.id, groupKey: f.groupKey, question: f.question, answer: f.answer })),
    });
  }

  if (type === "testimonials") {
    const testimonials = await db.testimonial.findMany({ where: PUBLIC_TESTIMONIAL_WHERE, take: 20 });
    return NextResponse.json({
      testimonials: testimonials.map((t) => ({
        id: t.id,
        clientName: t.clientName,
        clientRole: t.clientRole,
        quote: t.quote,
        rating: t.rating,
        verified: t.verified,
      })),
    });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    const requestedSection = url.searchParams.get("section");
    const section = ["guides", "insights", "international"].includes(requestedSection ?? "")
      ? requestedSection!
      : type === "articles" ? "insights" : "guides";
    const entry = await db.contentEntry.findFirst({
      where: {
        slug,
        ...publicContentWhere(),
        contentType: type === "guides" ? { in: ["GUIDE", "AREA_GUIDE"] } : type === "reports" ? "MARKET_REPORT" : { in: ["ARTICLE", "GUIDE"] },
      },
      include: { translationGroup: { select: { entries: { select: { locale: true, slug: true, status: true, publishedAt: true } } } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      entry: {
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        excerpt: entry.excerpt,
        body: entry.body,
        blocks: readContentBlocks(entry.bodyJson),
        category: entry.category,
        tags: entry.tagsJson ? JSON.parse(entry.tagsJson) : [],
        readingMinutes: entry.readingMinutes,
        publishedAt: entry.publishedAt?.toISOString() ?? null,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        sourceVerifiedAt: entry.sourceVerifiedAt?.toISOString() ?? null,
        freshnessReviewDueAt: entry.freshnessReviewDueAt?.toISOString() ?? null,
        contentType: entry.contentType,
        localeAlternates: publicContentLocaleAlternates(section, [
          { locale: entry.locale, slug: entry.slug, status: entry.status, publishedAt: entry.publishedAt },
          ...(entry.translationGroup?.entries ?? []),
        ]),
      },
    });
  }

  const entries = await db.contentEntry.findMany({
    where: {
      ...publicContentWhere(),
      locale: "en",
      contentType: type === "guides" ? { in: ["GUIDE", "AREA_GUIDE"] } : type === "reports" ? "MARKET_REPORT" : { in: ["ARTICLE", "GUIDE"] },
    },
    orderBy: { publishedAt: "desc" },
    take: 30,
    select: {
      id: true, slug: true, title: true, excerpt: true, category: true,
      readingMinutes: true, publishedAt: true, sourceName: true, sourceVerifiedAt: true, contentType: true,
    },
  });

  return NextResponse.json({
    entries: entries.map((e) => ({
      ...e,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      sourceVerifiedAt: e.sourceVerifiedAt?.toISOString() ?? null,
    })),
  });
});

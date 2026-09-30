import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import { submitLead } from "@/server/domain/lead-service";
import { publicMarketReportWhere } from "@/server/domain/visibility";
import { publicDocumentDownloadUrl } from "@/server/media/public-download-url";
import { grantedAnalyticsSessionId } from "@/server/privacy/analytics-attribution";
import { issueReportDownloadGrant } from "@/server/media/download-grant";

export const dynamic = "force-dynamic";

function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

/** GET: single published report detail */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const report = await db.marketReport.findFirst({ where: { slug, ...publicMarketReportWhere() } });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const availableDownloadUrl = await publicDocumentDownloadUrl(report.fileMediaId);
  return NextResponse.json({
    id: report.id,
    slug: report.slug,
    title: report.title,
    summary: report.summary,
    periodLabel: report.periodLabel,
    methodology: report.methodology,
    dataSourceName: report.dataSourceName,
    dataSourceUrl: safeSourceUrl(report.dataSourceUrl),
    retrievedAt: report.retrievedAt?.toISOString() ?? null,
    body: report.body,
    gated: report.gated,
    isIllustrative: report.isIllustrative,
    publishedAt: report.publishedAt?.toISOString() ?? null,
    fileAvailable: Boolean(availableDownloadUrl),
    downloadUrl: report.gated ? null : availableDownloadUrl,
  });
});

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  reportSlug: z.string().max(200),
  consentContact: z.literal(true),
  consentMarketing: z.boolean().default(false),
});

/** POST: gated report download — lead-for-document exchange (PART A26) */
export const POST = apiHandler(
  async (req, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);
    const report = await db.marketReport.findFirst({ where: { slug, ...publicMarketReportWhere() } });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const result = await submitLead({
      intent: "INVEST",
      name: input.name,
      email: input.email,
      consentContact: true,
      consentMarketing: input.consentMarketing,
      preferredLocale: "en",
      sourceChannel: "WEBSITE",
      message: `Report download: ${report.title}`,
      entityType: "MARKET_REPORT",
      entityId: report.id,
      entitySlug: report.slug,
      entityTitle: report.title,
      pagePath: `/market/reports/${report.slug}`,
    }, { attributionSessionId: await grantedAnalyticsSessionId(req) });
    return NextResponse.json({ ...result, downloadUrl: report.gated ? await issueReportDownloadGrant(report.fileMediaId, report.id) : await publicDocumentDownloadUrl(report.fileMediaId) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  },
  { rateLimit: { limit: 10, windowMs: 3600_000, key: "reportgate" } }
);

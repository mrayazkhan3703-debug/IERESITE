import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createMarketReport, updateMarketReport } from "@/server/domain/market-report-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("content:read");
  const query = new URL(req.url).searchParams.get("q")?.trim();
  const reports = await db.marketReport.findMany({
    where: query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { slug: { contains: query, mode: "insensitive" } }] } : {},
    orderBy: { updatedAt: "desc" }, take: 100, include: { _count: { select: { revisions: true } } },
  });
  return NextResponse.json({ reports: reports.map((report) => ({
    ...report,
    retrievedAt: report.retrievedAt?.toISOString() ?? null,
    publishedAt: report.publishedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    revisionCount: report._count.revisions,
  })) });
});

const baseSchema = z.object({
  slug: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(300),
  summary: z.string().max(1000).nullable().optional(),
  periodLabel: z.string().max(100).nullable().optional(),
  methodology: z.string().max(5000).nullable().optional(),
  dataSourceName: z.string().max(240).nullable().optional(),
  dataSourceUrl: z.string().max(2000).nullable().optional(),
  retrievedAt: z.string().datetime().nullable().optional(),
  body: z.string().max(50000),
  coverMediaId: z.string().min(1).nullable().optional(),
  fileMediaId: z.string().min(1).nullable().optional(),
  gated: z.boolean(),
  isIllustrative: z.boolean(),
  submitForReview: z.boolean().optional(),
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = baseSchema.strict().parse(await jsonBody<z.infer<typeof baseSchema>>(req));
  return NextResponse.json(await createMarketReport(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const schema = baseSchema.extend({ reportId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await updateMarketReport(actor, input, clientIp(req)));
});

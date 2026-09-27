import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { getDataState } from "@/lib/data-state";
import { publicMarketReportWhere } from "@/server/domain/visibility";
import { publicDocumentDownloadUrls } from "@/server/media/public-download-url";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const reports = await db.marketReport.findMany({
    where: publicMarketReportWhere(),
    orderBy: { publishedAt: "desc" },
  });
  const downloadUrls = await publicDocumentDownloadUrls(reports.flatMap((report) => report.fileMediaId ? [report.fileMediaId] : []));
  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      periodLabel: r.periodLabel,
      methodology: r.methodology,
      dataSourceName: r.dataSourceName,
      retrievedAt: r.retrievedAt?.toISOString() ?? null,
      gated: r.gated,
      isIllustrative: r.isIllustrative,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      /* U10 (§19.7) additive card fields — download state + search text for
       * client-side related-community/project chips. */
      searchBlob: `${r.title} ${r.summary ?? ""}`,
      fileAvailable: r.fileMediaId ? downloadUrls.has(r.fileMediaId) : false,
    })),
    dataState: getDataState(),
  });
});

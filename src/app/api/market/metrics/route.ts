import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { getDataState, resolveMetricState } from "@/lib/data-state";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const communitySlug = url.searchParams.get("community");
  const latest = url.searchParams.get("latest") === "1";

  // latest=1: newest period per (community, metricKey) — for cross-community comparison charts
  if (latest && !communitySlug) {
    const all = await db.marketMetric.findMany({
      include: { community: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ communityId: "asc" }, { metricKey: "asc" }, { periodStart: "desc" }],
    });
    type MetricWithCommunity = (typeof all)[number];
    const seen = new Set<string>();
    const metrics: MetricWithCommunity[] = [];
    for (const m of all) {
      const key = `${m.communityId}:${m.metricKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      metrics.push(m);
    }
    return NextResponse.json({
      metrics: metrics.map((m) => ({
        id: m.id,
        community: m.community,
        metricKey: m.metricKey,
        periodStart: m.periodStart.toISOString(),
        periodEnd: m.periodEnd.toISOString(),
        valueNumeric: m.valueNumeric,
        unit: m.unit,
        sourceName: m.sourceName,
        methodology: m.methodology,
        isIllustrative: m.isIllustrative,
        // Per-metric presentation state from the data-state machine (V2 §37).
        state: resolveMetricState({
          sourcePublisher: m.sourceName,
          sourceType: m.sourceName,
          methodology: m.methodology,
          retrievedAt: m.retrievedAt,
          isIllustrative: m.isIllustrative,
        }),
      })),
      dataState: getDataState(),
    });
  }

  const where = communitySlug
    ? { community: { slug: communitySlug } }
    : {};
  const metrics = await db.marketMetric.findMany({
    where,
    include: { community: { select: { id: true, name: true, slug: true } } },
    orderBy: [{ metricKey: "asc" }, { periodStart: "desc" }],
    take: 300,
  });
  return NextResponse.json({
    metrics: metrics.map((m) => ({
      id: m.id,
      community: m.community,
      metricKey: m.metricKey,
      periodStart: m.periodStart.toISOString(),
      periodEnd: m.periodEnd.toISOString(),
      valueNumeric: m.valueNumeric,
      unit: m.unit,
      sourceName: m.sourceName,
      methodology: m.methodology,
      isIllustrative: m.isIllustrative,
      // Per-metric presentation state from the data-state machine (V2 §37).
      state: resolveMetricState({
        sourcePublisher: m.sourceName,
        sourceType: m.sourceName,
        methodology: m.methodology,
        retrievedAt: m.retrievedAt,
        isIllustrative: m.isIllustrative,
      }),
    })),
    dataState: getDataState(),
  });
});

"use client";

/**
 * Atlas data assembly (U17 — V2 §29).
 *
 * Front-end composition of existing APIs (no new server surface):
 *  - /api/communities            → coordinates, listing counts, avg AED/sqft
 *  - /api/market/metrics?latest=1→ per-community latest metrics with the
 *                                   data-state machine state + provenance
 *                                   (AVG_PRICE_PER_SQFT / TRANSACTION_COUNT /
 *                                   AVG_RENT_1BR / YIELD_PCT / MEDIAN_TRANS_PRICE)
 *  - /api/market/transactions    → byCommunity volume aggregation (record-level)
 *  - /api/market/rents           → byCommunity rent aggregation (record-level)
 *  - /api/map                    → published projects (real coordinates) for the
 *                                   Projects layer
 *
 * Every metric value carries its MetricState so the UI can render a
 * DataStateBadge next to it (§37/§38 — no naked numbers).
 */

import type { MetricState } from "@/lib/data-state";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";

/** Human display for an atlas metric value (shared by 2D map, 3D scene and panel). */
export function formatAtlasMetricValue(key: AtlasMetricKey, value: number): string {
  switch (key) {
    case "ppsft":
      return `${formatAEDPrecise(value)} / sqft`;
    case "volume":
      return `${formatNumber(value)} transactions`;
    case "rent":
      return `${formatAEDPrecise(value)} / yr`;
    case "yield":
      return formatPctPrecise(value, 1);
    case "medianPrice":
      return formatAEDPrecise(value);
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AtlasMetricKey = "ppsft" | "volume" | "rent" | "yield" | "medianPrice";

export interface AtlasMetricValue {
  value: number;
  state: MetricState;
  /** Display period (latest metric window) — ISO date (period start). */
  periodStart: string | null;
  periodEnd: string | null;
  sourceName: string | null;
  unit: "AED" | "AED_PER_SQFT" | "PERCENT" | "COUNT";
}

export interface AtlasCommunity {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  listingCount: number;
  metrics: Partial<Record<AtlasMetricKey, AtlasMetricValue>>;
}

export interface AtlasProject {
  id: string;
  slug: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  communitySlug: string;
  communityName: string;
  developerName: string;
  startingPrice: { minor: string; currency: string } | null;
  totalUnits: number | null;
}

export interface AtlasData {
  communities: AtlasCommunity[];
  projects: AtlasProject[];
  /** Observed data coverage window across the metric records (read-only display). */
  coverage: { from: string | null; to: string | null };
}

/* ------------------------------------------------------------------ */
/* Metric catalogue                                                    */
/* ------------------------------------------------------------------ */

export interface MetricDefinition {
  key: AtlasMetricKey;
  /** marketMetric.metricKey backing this atlas metric. */
  sourceKey: string;
  i18nKey: string;
  unit: AtlasMetricValue["unit"];
  /** sale-side or rent-side metric (§29.4 sale/rent toggle). */
  side: "sale" | "rent";
}

export const ATLAS_METRICS: MetricDefinition[] = [
  { key: "ppsft", sourceKey: "AVG_PRICE_PER_SQFT", i18nKey: "atlas.metric.ppsft", unit: "AED_PER_SQFT", side: "sale" },
  { key: "volume", sourceKey: "TRANSACTION_COUNT", i18nKey: "atlas.metric.volume", unit: "COUNT", side: "sale" },
  { key: "medianPrice", sourceKey: "MEDIAN_TRANS_PRICE", i18nKey: "atlas.metric.medianPrice", unit: "AED", side: "sale" },
  { key: "yield", sourceKey: "YIELD_PCT", i18nKey: "atlas.metric.yield", unit: "PERCENT", side: "sale" },
  { key: "rent", sourceKey: "AVG_RENT_1BR", i18nKey: "atlas.metric.rent", unit: "AED", side: "rent" },
];

export function metricDefinition(key: AtlasMetricKey): MetricDefinition | undefined {
  return ATLAS_METRICS.find((m) => m.key === key);
}

/* ------------------------------------------------------------------ */
/* Fetch + assemble                                                    */
/* ------------------------------------------------------------------ */

interface MetricRow {
  community?: { id: string; name: string; slug: string } | null;
  metricKey: string;
  valueNumeric: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  sourceName: string | null;
  state: MetricState;
}

export async function fetchAtlasData(): Promise<AtlasData> {
  const [communitiesRes, metricsRes, txRes, rentRes, mapRes] = await Promise.all([
    fetch("/api/communities").then((r) => (r.ok ? r.json() : Promise.reject(new Error("communities")))),
    fetch("/api/market/metrics?latest=1").then((r) => (r.ok ? r.json() : Promise.reject(new Error("metrics")))),
    fetch("/api/market/transactions?pageSize=1").then((r) => (r.ok ? r.json() : { byCommunity: [] })),
    fetch("/api/market/rents?pageSize=1").then((r) => (r.ok ? r.json() : { byCommunity: [] })),
    fetch("/api/map").then((r) => (r.ok ? r.json() : Promise.reject(new Error("map")))),
  ]);

  interface CommunityCard {
    id: string;
    slug: string;
    name: string;
    lat: number;
    lng: number;
    listingCount: number;
  }
  const communities: CommunityCard[] = communitiesRes.communities ?? [];

  /* Metric rows keyed by community slug → atlas metric key. */
  const metricMap = new Map<string, Partial<Record<AtlasMetricKey, AtlasMetricValue>>>();
  let from: string | null = null;
  let to: string | null = null;
  for (const m of (metricsRes.metrics ?? []) as MetricRow[]) {
    const slug = m.community?.slug;
    if (!slug) continue;
    const def = ATLAS_METRICS.find((d) => d.sourceKey === m.metricKey);
    if (!def) continue;
    const entry = metricMap.get(slug) ?? {};
    entry[def.key] = {
      value: m.valueNumeric,
      state: m.state,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      sourceName: m.sourceName,
      unit: def.unit,
    };
    metricMap.set(slug, entry);
    if (!from || m.periodStart < from) from = m.periodStart;
    if (!to || m.periodEnd > to) to = m.periodEnd;
  }

  /* Record-level aggregation enrichment (transactions/rents APIs) — used when
     a metric row is missing for a community (honest gap-filling with the
     same ILLUSTRATIVE caveat the explorer uses for derived figures). */
  const txByArea = new Map<string, number>();
  for (const row of txRes.byCommunity ?? []) txByArea.set(row.areaName, row.count);
  const rentByArea = new Map<string, number>();
  for (const row of rentRes.byCommunity ?? []) {
    if (row.avgAmountMinor != null) rentByArea.set(row.areaName, Number(row.avgAmountMinor) / 100);
  }

  const assembled: AtlasCommunity[] = communities.map((c) => {
    const metrics = { ...(metricMap.get(c.slug) ?? {}) };
    if (!metrics.volume && txByArea.has(c.name)) {
      metrics.volume = {
        value: txByArea.get(c.name)!,
        state: "ILLUSTRATIVE" as MetricState,
        periodStart: null,
        periodEnd: null,
        sourceName: "Recorded transactions (aggregated)",
        unit: "COUNT",
      };
    }
    if (!metrics.rent && rentByArea.has(c.name) && (rentByArea.get(c.name) ?? 0) > 0) {
      metrics.rent = {
        value: rentByArea.get(c.name)!,
        state: "ILLUSTRATIVE" as MetricState,
        periodStart: null,
        periodEnd: null,
        sourceName: "Recorded rent contracts (aggregated)",
        unit: "AED",
      };
    }
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      radiusMeters: 2500,
      listingCount: c.listingCount ?? 0,
      metrics,
    };
  });

  const projects: AtlasProject[] = (mapRes.projects ?? []).map((p: {
    id: string;
    slug: string;
    name: string;
    status: string;
    lat: number;
    lng: number;
    community: { slug: string; name: string };
    developer: { name: string };
    startingPrice: { minor: string; currency: string } | null;
    totalUnits: number | null;
  }) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    lat: p.lat,
    lng: p.lng,
    communitySlug: p.community.slug,
    communityName: p.community.name,
    developerName: p.developer.name,
    startingPrice: p.startingPrice,
    totalUnits: p.totalUnits,
  }));

  return { communities: assembled, projects, coverage: { from, to } };
}

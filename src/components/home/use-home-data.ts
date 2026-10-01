"use client";

/**
 * U03 homepage data hook — one place for every §11 section's API contract.
 * Existing endpoints only (no new backend); each surface degrades to an
 * honest empty state instead of fabricated values.
 */

import * as React from "react";
import { api } from "@/lib/api-client";
import type { ListingCardDTO, CommunityCardDTO, ProjectCardDTO, AgentDTO } from "@/lib/types";
import type { MetricState } from "@/lib/data-state";
import type { PropertyCommunityContext } from "@/components/property/property-card";

/** Per-community market metrics joined from /api/market/metrics?latest=1. */
export interface CommunityMetricSet {
  slug: string;
  name: string;
  avgPricePerSqft?: number;
  avgRent1Br?: number;
  medianTransPrice?: number;
  transactionCount?: number;
  yieldPct?: number;
  state?: MetricState;
  periodEnd?: string;
  sourceName?: string;
  methodology?: string | null;
}

/** §11.2 market pulse strip values, each carrying its provenance. */
export interface MarketPulse {
  latestDataDate: string | null;
  transactionTotal: number | null;
  transactionSampleSize: number;
  medianPsqft: number | null;
  perSqftEligible: number | null;
  offPlanListings: number | null;
  readyListings: number | null;
  rentalContracts: number | null;
  rentalExcluded: number | null;
  communityCount: number;
  dataState: string | null;
  metricState: MetricState | null;
  sourceName: string | null;
  methodology: string | null;
}

interface MetricsResponse {
  metrics: {
    community?: { slug: string; name: string } | null;
    metricKey: string;
    periodStart: string;
    periodEnd: string;
    valueNumeric: number;
    unit: string;
    sourceName: string;
    methodology?: string | null;
    isIllustrative: boolean;
    state?: MetricState;
  }[];
  dataState: string;
}

interface TransactionsResponse {
  validation: { totalRecords: number; validRecords: number; excludedRecords: number; perSqftEligibleRecords: number };
  dataState: string;
  total: number;
  rows: { pricePerSqftMinor?: string | null; state?: MetricState; source?: string }[];
}

interface RentsResponse {
  validation: { totalRecords: number; validRecords: number; excludedRecords: number };
  dataState: string;
  total: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface HomeData {
  failedFeeds: string[];
  featured: ListingCardDTO[] | null;
  radarPool: ListingCardDTO[] | null;
  projects: ProjectCardDTO[] | null;
  communities: CommunityCardDTO[] | null;
  communityMetrics: Record<string, CommunityMetricSet> | null;
  agents: AgentDTO[] | null;
  pulse: MarketPulse | null;
  research: { guides: number; insights: number } | null;
  /** Community-card context for the V2 property-card evidence layer. */
  contextFor: (communitySlug: string) => PropertyCommunityContext | undefined;
}

export function useHomeData(): HomeData {
  const [failedFeeds, setFailedFeeds] = React.useState<string[]>([]);
  const [featured, setFeatured] = React.useState<ListingCardDTO[] | null>(null);
  const [radarPool, setRadarPool] = React.useState<ListingCardDTO[] | null>(null);
  const [projects, setProjects] = React.useState<ProjectCardDTO[] | null>(null);
  const [communities, setCommunities] = React.useState<CommunityCardDTO[] | null>(null);
  const [communityMetrics, setCommunityMetrics] = React.useState<Record<string, CommunityMetricSet> | null>(null);
  const [agents, setAgents] = React.useState<AgentDTO[] | null>(null);
  const [pulse, setPulse] = React.useState<MarketPulse | null>(null);
  const [research, setResearch] = React.useState<{ guides: number; insights: number } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let active = true;
    const failed = (name: string) => { if (active) setFailedFeeds((previous) => [...new Set([...previous, name])]); };
    const load = <T,>(path: string) => api.get<T>(path, controller.signal);
    void load<{ results: ListingCardDTO[] }>("/api/properties?featured=1&limit=6").then((r) => { if (active) setFeatured(r.results ?? []); }).catch(() => { failed("featured inventory"); if (active) setFeatured([]); });
    void load<{ results: ListingCardDTO[] }>("/api/properties?limit=9").then((r) => { if (active) setRadarPool(r.results ?? []); }).catch(() => { failed("inventory"); if (active) setRadarPool([]); });
    void load<{ projects: ProjectCardDTO[] }>("/api/projects?limit=4").then((r) => { if (active) setProjects(r.projects ?? []); }).catch(() => { failed("projects"); if (active) setProjects([]); });
    void load<{ communities: CommunityCardDTO[] }>("/api/communities").then((r) => { if (active) setCommunities(r.communities ?? []); }).catch(() => { failed("communities"); if (active) setCommunities([]); });
    void load<{ agents: AgentDTO[] }>("/api/agents?public=1").then((r) => { if (active) setAgents((r.agents ?? []).slice(0, 4)); }).catch(() => { failed("advisors"); if (active) setAgents([]); });

    // Start independent feeds together: a metrics failure cannot suppress live
    // inventory counts or published research. Each request has a bounded wait.
    void Promise.allSettled([
      load<MetricsResponse>("/api/market/metrics?latest=1"),
      load<TransactionsResponse>("/api/market/transactions?pageSize=50"),
      load<RentsResponse>("/api/market/rents?pageSize=1"),
      load<{ total: number }>("/api/properties?limit=1"),
      load<{ total: number }>("/api/properties?offPlan=1&limit=1"),
      load<{ entries: unknown[] }>("/api/content/guides"),
      load<{ entries: unknown[] }>("/api/content/insights"),
    ]).then(([metrics, tx, rents, allListings, offPlanListings, guides, insights]) => {
      if (!active) return;
      const names = ["community metrics", "transactions", "rents", "inventory totals", "off-plan totals", "guides", "insights"];
      [metrics, tx, rents, allListings, offPlanListings, guides, insights].forEach((result, index) => { if (result.status === "rejected") failed(names[index]); });
      const r = metrics.status === "fulfilled" ? metrics.value : null;
      const bySlug: Record<string, CommunityMetricSet> = {};
      let latestEnd: string | null = null;
      for (const m of r?.metrics ?? []) {
        const slug = m.community?.slug; if (!slug) continue;
        const entry = (bySlug[slug] ??= { slug, name: m.community?.name ?? slug, state: m.state, periodEnd: m.periodEnd, sourceName: m.sourceName, methodology: m.methodology ?? null });
        switch (m.metricKey) {
          case "AVG_PRICE_PER_SQFT": entry.avgPricePerSqft = m.valueNumeric; break;
          case "AVG_RENT_1BR": entry.avgRent1Br = m.valueNumeric; break;
          case "MEDIAN_TRANS_PRICE": entry.medianTransPrice = m.valueNumeric; break;
          case "TRANSACTION_COUNT": entry.transactionCount = m.valueNumeric; break;
          case "YIELD_PCT": entry.yieldPct = m.valueNumeric; break;
        }
        if (!latestEnd || m.periodEnd > latestEnd) latestEnd = m.periodEnd;
      }
      setCommunityMetrics(bySlug);
      const txOk = tx.status === "fulfilled" ? tx.value : null;
      const sample = (txOk?.rows ?? []).filter((row) => row.pricePerSqftMinor).map((row) => Number(row.pricePerSqftMinor) / 100).filter((n) => Number.isFinite(n) && n > 0);
      const totalAll = allListings.status === "fulfilled" ? allListings.value.total : null;
      const totalOffPlan = offPlanListings.status === "fulfilled" ? offPlanListings.value.total : null;
      setPulse({ latestDataDate: latestEnd, transactionTotal: txOk?.total ?? null, transactionSampleSize: sample.length, medianPsqft: median(sample), perSqftEligible: txOk?.validation.perSqftEligibleRecords ?? null,
        offPlanListings: totalOffPlan, readyListings: totalAll !== null && totalOffPlan !== null ? Math.max(0, totalAll - totalOffPlan) : null,
        rentalContracts: rents.status === "fulfilled" ? rents.value.total : null, rentalExcluded: rents.status === "fulfilled" ? rents.value.validation.excludedRecords : null,
        communityCount: Object.keys(bySlug).length, dataState: r?.dataState ?? null, metricState: r?.metrics[0]?.state ?? null, sourceName: r?.metrics[0]?.sourceName ?? null, methodology: r?.metrics[0]?.methodology ?? null });
      setResearch(guides.status === "fulfilled" && insights.status === "fulfilled" ? { guides: guides.value.entries.length, insights: insights.value.entries.length } : null);
    });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);

  const contextFor = React.useCallback(
    (communitySlug: string): PropertyCommunityContext | undefined => {
      const m = communityMetrics?.[communitySlug];
      if (!m) return undefined;
      return {
        avgPricePerSqft: m.avgPricePerSqft ?? null,
        benchmarkState: m.state ?? null,
        yieldPct: m.yieldPct ?? null,
        yieldState: m.state ?? null,
      };
    },
    [communityMetrics]
  );

  return { failedFeeds, featured, radarPool, projects, communities, communityMetrics, agents, pulse, research, contextFor };
}

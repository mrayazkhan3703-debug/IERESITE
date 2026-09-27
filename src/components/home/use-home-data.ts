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
  const [featured, setFeatured] = React.useState<ListingCardDTO[] | null>(null);
  const [radarPool, setRadarPool] = React.useState<ListingCardDTO[] | null>(null);
  const [projects, setProjects] = React.useState<ProjectCardDTO[] | null>(null);
  const [communities, setCommunities] = React.useState<CommunityCardDTO[] | null>(null);
  const [communityMetrics, setCommunityMetrics] = React.useState<Record<string, CommunityMetricSet> | null>(null);
  const [agents, setAgents] = React.useState<AgentDTO[] | null>(null);
  const [pulse, setPulse] = React.useState<MarketPulse | null>(null);
  const [research, setResearch] = React.useState<{ guides: number; insights: number } | null>(null);

  React.useEffect(() => {
    api
      .get<{ results: ListingCardDTO[] }>("/api/properties?featured=1&limit=6")
      .then((r) => setFeatured(r.results ?? []))
      .catch(() => setFeatured([]));

    api
      .get<{ results: ListingCardDTO[] }>("/api/properties?limit=9")
      .then((r) => setRadarPool(r.results ?? []))
      .catch(() => setRadarPool([]));

    api
      .get<{ projects: ProjectCardDTO[] }>("/api/projects?limit=4")
      .then((r) => setProjects(r.projects ?? []))
      .catch(() => setProjects([]));

    api
      .get<{ communities: CommunityCardDTO[] }>("/api/communities")
      .then((r) => setCommunities(r.communities ?? []))
      .catch(() => setCommunities([]));

    api
      .get<MetricsResponse>("/api/market/metrics?latest=1")
      .then(async (r) => {
        const bySlug: Record<string, CommunityMetricSet> = {};
        let latestEnd: string | null = null;
        for (const m of r.metrics) {
          const slug = m.community?.slug;
          if (!slug) continue;
          const entry = (bySlug[slug] ??= {
            slug,
            name: m.community?.name ?? slug,
            state: m.state,
            periodEnd: m.periodEnd,
            sourceName: m.sourceName,
            methodology: m.methodology ?? null,
          });
          switch (m.metricKey) {
            case "AVG_PRICE_PER_SQFT":
              entry.avgPricePerSqft = m.valueNumeric;
              break;
            case "AVG_RENT_1BR":
              entry.avgRent1Br = m.valueNumeric;
              break;
            case "MEDIAN_TRANS_PRICE":
              entry.medianTransPrice = m.valueNumeric;
              break;
            case "TRANSACTION_COUNT":
              entry.transactionCount = m.valueNumeric;
              break;
            case "YIELD_PCT":
              entry.yieldPct = m.valueNumeric;
              break;
          }
          if (!latestEnd || m.periodEnd > latestEnd) latestEnd = m.periodEnd;
        }
        setCommunityMetrics(bySlug);

        /* Pulse needs three more small responses; failures degrade to nulls
           rather than blocking the rest of the strip. */
        const [tx, rents, allListings, offPlanListings, guides, insights] = await Promise.allSettled([
          api.get<TransactionsResponse>("/api/market/transactions?pageSize=50"),
          api.get<RentsResponse>("/api/market/rents?pageSize=1"),
          api.get<{ total: number }>("/api/properties?limit=1"),
          api.get<{ total: number }>("/api/properties?offPlan=1&limit=1"),
          api.get<{ entries: unknown[] }>("/api/content/guides"),
          api.get<{ entries: unknown[] }>("/api/content/insights"),
        ]);
        const txOk = tx.status === "fulfilled" ? tx.value : null;
        const psqftSample = txOk
          ? txOk.rows
              .filter((row) => row.pricePerSqftMinor)
              .map((row) => Number(row.pricePerSqftMinor) / 100)
          : [];
        const totalAll = allListings.status === "fulfilled" ? allListings.value.total : null;
        const totalOffPlan = offPlanListings.status === "fulfilled" ? offPlanListings.value.total : null;
        setPulse({
          latestDataDate: latestEnd,
          transactionTotal: txOk ? txOk.total : null,
          transactionSampleSize: psqftSample.length,
          medianPsqft: median(psqftSample),
          perSqftEligible: txOk ? txOk.validation.perSqftEligibleRecords : null,
          offPlanListings: totalOffPlan,
          readyListings: totalAll !== null && totalOffPlan !== null ? Math.max(0, totalAll - totalOffPlan) : null,
          rentalContracts: rents.status === "fulfilled" ? rents.value.total : null,
          rentalExcluded: rents.status === "fulfilled" ? rents.value.validation.excludedRecords : null,
          communityCount: Object.keys(bySlug).length,
          dataState: r.dataState ?? null,
          metricState: r.metrics[0]?.state ?? null,
          sourceName: r.metrics[0]?.sourceName ?? null,
          methodology: r.metrics[0]?.methodology ?? null,
        });
        setResearch({
          guides: guides.status === "fulfilled" ? guides.value.entries.length : 0,
          insights: insights.status === "fulfilled" ? insights.value.entries.length : 0,
        });
      })
      .catch(() => {
        setCommunityMetrics({});
        setPulse({
          latestDataDate: null,
          transactionTotal: null,
          transactionSampleSize: 0,
          medianPsqft: null,
          perSqftEligible: null,
          offPlanListings: null,
          readyListings: null,
          rentalContracts: null,
          rentalExcluded: null,
          communityCount: 0,
          dataState: null,
          metricState: null,
          sourceName: null,
          methodology: null,
        });
      });

    api
      /* V3-02 (§13): public advisors only — the home advisor strip shows real
       * people; verified-attribute filters are gone until CRM data exists. */
      .get<{ agents: AgentDTO[] }>("/api/agents?public=1")
      .then((r) => setAgents((r.agents ?? []).slice(0, 4)))
      .catch(() => setAgents([]));
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

  return { featured, radarPool, projects, communities, communityMetrics, agents, pulse, research, contextFor };
}

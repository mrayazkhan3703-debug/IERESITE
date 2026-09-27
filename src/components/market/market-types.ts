/**
 * Shared market-intelligence types (U10 §19) — mirror the additive API
 * contracts of /api/market/transactions and /api/market/rents.
 *
 * Both explorers consume the SAME response shape so the shared explorer
 * component can render either variant from one typed contract.
 */

import type { MetricState } from "@/lib/data-state";
import type { ExplorerSeriesPoint } from "@/components/charts/explorer-volume-chart";

/** Data-quality validation summary (V2 §19.5) — mirrors the API contract. */
export interface MarketValidation {
  totalRecords: number;
  validRecords: number;
  excludedRecords: number;
  exclusionReasons: Record<string, number>;
  perSqftEligibleRecords: number;
}

export interface MarketRow {
  id: string;
  /** Sale transactions: transactionDate — Rental contracts: contractDate */
  transactionDate?: string;
  contractDate?: string;
  areaName: string;
  propertyType: string;
  transactionType?: string;
  /** Sale transactions: amountMinor — Rental contracts: annualRentMinor */
  amountMinor?: string;
  annualRentMinor?: string;
  currency: string;
  sizeSqft: number | null;
  pricePerSqftMinor?: string | null;
  projectName: string | null;
  /** Rental contracts only */
  bedrooms?: number | null;
  isIllustrative: boolean;
  source: string;
  /** Presentation state from the data-state machine (V2 §37). */
  state?: MetricState;
}

export interface MarketAreaAgg {
  areaName: string;
  count: number;
  medianAmountMinor?: string | null;
  avgAmountMinor?: string | null;
  medianRentMinor?: string | null;
  avgRentMinor?: string | null;
  medianPerSqftMinor?: string | null;
}

export interface MarketDistributionBucket {
  label: string;
  fromMinor: string;
  toMinor: string | null;
  count: number;
}

export interface MarketAreaSeriesPoint {
  month: string;
  count: number;
  medianAmountMinor: string | null;
}

export interface MarketAreaSeries {
  areaName: string;
  monthly: MarketAreaSeriesPoint[];
}

/** U10 additive aggregation block (§19.4/§19.5). */
export interface MarketAgg {
  count: number;
  totalVolumeMinor?: string;
  medianAmountMinor?: string | null;
  avgAmountMinor?: string | null;
  medianRentMinor?: string | null;
  avgRentMinor?: string | null;
  medianPerSqftMinor?: string | null;
  perSqftCount?: number;
  excludedRecords: number;
  dateMin: string | null;
  dateMax: string | null;
  distribution: MarketDistributionBucket[];
  byPropertyType: { type: string; count: number; medianAmountMinor: string | null }[];
  byBedrooms?: { bedrooms: number; count: number; medianRentMinor: string | null }[];
  byAreaFull: MarketAreaAgg[];
  areaSeries: MarketAreaSeries[];
  filterOptions: {
    areas: { areaName: string; count: number }[];
    propertyTypes: { type: string; count: number }[];
  };
}

export interface MarketResponse {
  rows: MarketRow[];
  total: number;
  page: number;
  pageSize: number;
  byCommunity?: { areaName: string; count: number; avgAmountMinor: string | null; trend?: number[] }[];
  series?: ExplorerSeriesPoint[];
  validation?: MarketValidation;
  dataState?: string;
  agg?: MarketAgg;
}

/** Report list item (upgraded cards §19.7). */
export interface MarketReportCard {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  periodLabel: string | null;
  methodology: string | null;
  dataSourceName: string | null;
  retrievedAt: string | null;
  gated: boolean;
  isIllustrative: boolean;
  publishedAt: string | null;
  searchBlob?: string;
  fileAvailable?: boolean;
}

/** Latest per-community metric (metrics?latest=1 contract). */
export interface LatestMetric {
  id: string;
  community: { id: string; name: string; slug: string };
  metricKey: string;
  periodStart: string;
  periodEnd: string;
  valueNumeric: number;
  unit: string;
  sourceName: string;
  methodology: string | null;
  isIllustrative: boolean;
  state?: MetricState;
}

/** Community card DTO (from /api/communities). */
export interface CommunityCardLite {
  id: string;
  slug: string;
  name: string;
  areaType: string;
  listingCount: number;
  avgPricePerSqft: { minor: string; currency: string } | null;
  lat: number | null;
  lng: number | null;
  lifestyleTags: string[];
}

/** Provenance payload for the per-chart source drawer (§19.4). */
export interface SourceInfo {
  title: string;
  source: string;
  state?: MetricState;
  dataState?: string;
  coverage?: { from: string | null; to: string | null; records: number };
  methodology?: string | null;
  exclusions?: { excluded: number; reasons: Record<string, number> };
}

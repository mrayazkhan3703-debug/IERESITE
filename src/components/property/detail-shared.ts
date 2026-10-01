"use client";

/**
 * Property Detail V2 shared foundation (U06 — V2 §14).
 *
 * Types + pure helpers shared by the property detail view and its section
 * components (gallery, sticky panel, market context, cost panel, location,
 * similar, price history). No section-specific rendering lives here.
 */

import * as React from "react";
import { api } from "@/lib/api-client";
import { resolveMetricState, type MetricState } from "@/lib/data-state";
import type { ListingCardDTO, MediaDTO } from "@/lib/types";

/* ------------------------------------------------------------------ types --- */

export interface PropertyDetailAgent {
  id: string;
  slug: string;
  name: string;
  jobTitle: string;
  bio: string | null;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  email?: string | null;
  photo?: MediaDTO | null;
  languages: { code: string; name: string; fluency: string }[];
  specialties: string[];
  communities: unknown[];
  yearsExperience: number;
  active?: boolean;
  /** LEGACY (V3-02): unverified — UI must not display capacity. */
  leadCapacityState?: string | null;
  /* V3-02 verified-team fields (additive) */
  department?: string | null;
  publicAdvisor?: boolean;
  phoneDisplay?: string | null;
  photoUrl?: string | null;
}

export interface PropertyDetailListing {
  id: string;
  listingType: string;
  priceMinor: string;
  currency: string;
  priceQualifier: string | null;
  rentFrequency: string | null;
  availabilityStatus: string;
  offPlan: boolean;
  isFeatured: boolean;
  isExclusive: boolean;
  serviceChargePerSqft: number | null;
  publishedAt: string | null;
}

/** V2 property detail response (base DTO + additive U06 freshness fields). */
export interface PropertyDetailV2 {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  shortDescription: string | null;
  highlights: string[];
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  builtUpAreaSqft: number | null;
  plotAreaSqft: number | null;
  furnishing: string | null;
  view: string | null;
  floor: number | null;
  totalFloors: number | null;
  handoverQuarter: string | null;
  reraPermit: string | null;
  lat: number;
  lng: number;
  addressLine: string | null;
  listingRef: string;
  updatedAt: string;
  listingUpdatedAt: string | null;
  listing: PropertyDetailListing | null;
  community: { id: string; name: string; slug: string; summary: string | null; lat: number; lng: number };
  project: { id: string; name: string; slug: string; status: string; handoverDate: string | null; completionPercent: number | null } | null;
  developer: { id: string; name: string; slug: string; verificationStatus: string } | null;
  agent: PropertyDetailAgent | null;
  media: MediaDTO[];
  floorPlans: {
    id: string;
    label: string | null;
    bedrooms: number | null;
    areaSqft: number | null;
    priceMinor: string | null;
    media: MediaDTO;
  }[];
  documents: { id: string; label: string | null; docType: string; gated: boolean; url: string }[];
  amenities: { key: string; name: string; category: string }[];
  priceHistory: { priceMinor: string; recordedAt: string; sourceType: string }[];
  paymentPlan: {
    name: string;
    totalPercent: number;
    postHandover: boolean;
    verificationStatus: string;
    installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[];
  } | null;
  similar: ListingCardDTO[];
  isDemoData: boolean;
  sourceType: string;
  sourceUpdatedAt: string | null;
  nearby: { name: string; slug: string; distanceKm: number }[];
}

/** Community detail payload consumed by market context + location intelligence. */
export interface CommunityDetailLite {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number | null;
  lifestyleTags: string[];
  transport: { type: string; name: string; distance: string }[];
  schools: { name: string; rating: string }[];
  healthcare: { name: string; type: string }[];
  retail: { name: string; type: string }[];
  boundary: unknown;
  projects: unknown[];
  isDemoData: boolean;
}

/* ---------------------------------------------------------------- helpers --- */

/** Compact investment snapshot for the sticky panel (§14.3, MODELED-labeled). */
export interface InvestmentSnapshot {
  grossYieldPct: number;
  netYieldPct: number;
  effectiveMonthlyRent: number;
  netIncomeAnnual: number;
}

/** Rent benchmark resolved from the market rents explorer for the community. */
export interface RentBenchmark {
  /** Median annual rent (AED, major units) of observed contracts, null = no data. */
  medianAnnualRent: number | null;
  /** Observed contract count behind the median. */
  sampleCount: number;
  /** Per-figure presentation state (§37) of the underlying rows. */
  state: MetricState;
  /** Area name the benchmark resolved for (may differ from community display name). */
  areaName: string;
}

interface MarketRentRow {
  id: string;
  contractDate: string;
  areaName: string;
  propertyType: string;
  bedrooms: number;
  annualRentMinor: string;
  currency: string;
  sizeSqft: number | null;
  isIllustrative: boolean;
  source: string;
  state: MetricState;
}

/**
 * Resolve a community rent benchmark from the validated rents explorer
 * (/api/market/rents). Prefer contracts matching the listing's bedroom count;
 * fall back to all contracts in the area with the sample count disclosed.
 * Returns null while loading or when the area has no rent records.
 */
export function useRentBenchmark(communityName: string | null, bedrooms: number | null): RentBenchmark | null {
  const [benchmark, setBenchmark] = React.useState<RentBenchmark | null>(null);

  React.useEffect(() => {
    if (!communityName) return;
    let cancelled = false;
    api
      .get<{ rows: MarketRentRow[]; validation: { validRecords: number } }>(
        `/api/market/rents?community=${encodeURIComponent(communityName)}&pageSize=50`
      )
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.rows ?? []).filter((r) => r.annualRentMinor && Number(r.annualRentMinor) > 0);
        if (rows.length === 0) {
          setBenchmark({ medianAnnualRent: null, sampleCount: 0, state: "UNAVAILABLE", areaName: communityName });
          return;
        }
        const matching = bedrooms !== null ? rows.filter((r) => r.bedrooms === bedrooms) : [];
        const used = matching.length >= 3 ? matching : rows;
        const rents = used.map((r) => Number(r.annualRentMinor) / 100).sort((a, b) => a - b);
        const median = rents.length % 2 === 1 ? rents[(rents.length - 1) / 2] : (rents[rents.length / 2 - 1] + rents[rents.length / 2]) / 2;
        setBenchmark({
          medianAnnualRent: Math.round(median),
          sampleCount: used.length,
          state: used[0]?.state ?? "UNAVAILABLE",
          areaName: communityName,
        });
      })
      .catch(() => {
        if (!cancelled) setBenchmark({ medianAnnualRent: null, sampleCount: 0, state: "UNAVAILABLE", areaName: communityName });
      });
    return () => {
      cancelled = true;
    };
  }, [communityName, bedrooms]);

  return benchmark;
}

/** Median of a numeric array (null-safe, empty → null). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Relative time label ("3 days ago" / "5 months ago"); null-safe. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, label] of units) {
    if (seconds >= secs) {
      const n = Math.floor(seconds / secs);
      return `${n} ${label}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Humanize a store enum: "DEMO_SEED" → "demo seed". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").toLowerCase();
}

/** Per-point presentation state for a price-history row (client-side §37 machine). */
export function pricePointState(sourceType: string | null | undefined, isDemoData: boolean): MetricState {
  return resolveMetricState({ sourceType: sourceType ?? null, isDemoData: isDemoData || null });
}

/** Convert a property detail payload to the saved/compare card DTO (store shape). */
export function detailToCard(d: PropertyDetailV2): ListingCardDTO {
  return {
    id: d.listing?.id ?? d.id,
    slug: d.slug,
    title: d.title,
    propertyType: d.propertyType,
    listingType: (d.listing?.listingType ?? "SALE") as ListingCardDTO["listingType"],
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    areaSqft: d.builtUpAreaSqft,
    price: { minor: d.listing?.priceMinor ?? "0", currency: d.listing?.currency ?? "AED" },
    availabilityStatus: d.listing?.availabilityStatus ?? "AVAILABLE",
    offPlan: d.listing?.offPlan ?? false,
    isFeatured: d.listing?.isFeatured ?? false,
    isExclusive: d.listing?.isExclusive ?? false,
    community: { id: d.community.id, name: d.community.name, slug: d.community.slug },
    project: d.project ? { id: d.project.id, name: d.project.name, slug: d.project.slug } : null,
    developer: d.developer ? { id: d.developer.id, name: d.developer.name, slug: d.developer.slug } : null,
    agent: null,
    cover: d.media[0] ? { ...d.media[0] } : null,
    lat: d.lat,
    lng: d.lng,
    handoverQuarter: d.handoverQuarter,
    view: d.view,
    furnishing: d.furnishing,
    isDemoData: d.isDemoData,
  };
}

/** Yield model assumptions used by every modeled surface on this page (one source). */
export const YIELD_MODEL_ASSUMPTIONS = {
  /** Vacancy allowance, % of scheduled rent */
  vacancyAllowancePct: 5,
  /** Maintenance assumption, % of purchase price per year */
  maintenancePctOfPrice: 1,
  /** Property management fee, % of effective rent (investment use) */
  managementPct: 5,
} as const;

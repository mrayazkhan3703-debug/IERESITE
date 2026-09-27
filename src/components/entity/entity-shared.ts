"use client";

/**
 * Entity detail V2 shared foundation (U07/U08 — V2 §15/§16/§17/§18).
 *
 * Types + pure helpers shared by the project / community / developer / advisor
 * detail pages and their section components (entity map, market intelligence,
 * POI & commute, payment timeline, unit inventory, similar entities).
 * No section-specific rendering lives here.
 */

import type { MediaDTO } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

/* ------------------------------------------------------------------ types --- */

export interface EntityMetricRow {
  metricKey: string;
  periodStart: string;
  valueNumeric: number;
  unit: string;
  sourceName: string;
  methodology: string | null;
  isIllustrative: boolean;
}

export interface EntityListingLite {
  slug: string;
  title: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: string;
  currency: string;
  listingType: string;
  availabilityStatus: string;
  cover: MediaDTO | null;
  lat: number;
  lng: number;
}

export interface EntityAgentLite {
  slug: string;
  name: string;
  jobTitle: string;
  photo: MediaDTO | null;
  leadCapacityState: string;
  phoneE164: string | null;
  whatsappE164: string | null;
  /** V3: direct static asset path for team member / advisory-desk photos. */
  photoUrl?: string | null;
  /** V3: human-readable display form of phoneE164 (may be non-UAE format). */
  phoneDisplay?: string | null;
}

export interface CommunityDetailV2 {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  areaType: string;
  lat: number;
  lng: number;
  radiusMeters: number | null;
  avgPricePerSqftMinor: string | null;
  currency: string;
  lifestyleTags: string[];
  transport: { type: string; name: string; distance: string }[];
  schools: { name: string; rating: string }[];
  healthcare: { name: string; type: string }[];
  retail: { name: string; type: string }[];
  boundary: unknown;
  image: MediaDTO | null;
  properties: EntityListingLite[];
  saleProperties: EntityListingLite[];
  rentProperties: EntityListingLite[];
  projects: {
    slug: string;
    name: string;
    status: string;
    developerName: string;
    developerSlug: string;
    startingPriceMinor: string | null;
    currency: string;
    handoverDate: string | null;
    completionPercent: number | null;
    totalUnits: number | null;
    cover: MediaDTO | null;
    lat: number;
    lng: number;
  }[];
  metrics: EntityMetricRow[];
  propertyTypeCounts: { propertyType: string; count: number }[];
  supplyPipeline: { totalProjects: number; underConstruction: number; offPlan: number; ready: number };
  agents: EntityAgentLite[];
  isDemoData: boolean;
}

export interface DeveloperDetailV2 {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  websiteUrl: string | null;
  headquarters: string | null;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  foundedYear: number | null;
  projects: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    status: string;
    community: { id: string; name: string; slug: string };
    developer: { id: string; name: string; slug: string };
    startingPrice: { minor: string; currency: string } | null;
    handoverDate: string | null;
    completionPercent: number | null;
    cover: MediaDTO | null;
    totalUnits: number | null;
    unitCount: number;
    lat: number;
    lng: number;
  }[];
  paymentPlanPatterns: {
    projectId: string;
    projectSlug: string;
    projectName: string;
    planId: string;
    planName: string;
    verificationStatus: string;
    isDefault: boolean;
    installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[];
  }[];
  deliverySummary: { total: number; completed: number; underConstruction: number; offPlan: number; ready: number };
  isDemoData: boolean;
}

/* --------------------------------------------------------------- helpers --- */

/** Straight-line (haversine) distance in km — always labeled as such in UI. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Commute anchors used on entity pages (straight-line reference points). */
export const COMMUTE_ANCHORS: { key: string; name: string; lat: number; lng: number }[] = [
  { key: "difc", name: "DIFC", lat: 25.2138, lng: 55.2822 },
  { key: "downtown", name: "Downtown Dubai", lat: 25.1972, lng: 55.2744 },
];

/** Deterministic quarter label for an ISO date: "2028-04-02" → "Q2 2028". */
export function quarterLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

/**
 * Handover presentation (§15 summary header): explicit quarter label, with the
 * exact date available as a tooltip — never a vague "2028".
 */
export function handoverPresentation(iso: string | null | undefined): { label: string; fullLabel: string | null } | null {
  const q = quarterLabel(iso);
  if (!q || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: q, fullLabel: null };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { label: q, fullLabel: `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

/** Parse a tower/building identifier from a unit number ("A-1204" → "A"). */
export function towerOfUnitNumber(unitNumber: string | null | undefined): string | null {
  if (!unitNumber) return null;
  const m = unitNumber.match(/^([A-Za-z]+[0-9]*)\s*-/);
  return m ? m[1].toUpperCase() : null;
}

/** Humanize a stored enum: "UNDER_CONSTRUCTION" → "under construction". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").toLowerCase();
}

/** Title-case humanized enum: "OFF_PLAN" → "Off plan". */
export function humanizeTitle(value: string | null | undefined): string {
  const h = humanizeEnum(value);
  return h ? h.charAt(0).toUpperCase() + h.slice(1) : "";
}

/** Capacity chip styling per leadCapacityState. */
export function capacityStyle(state: string | null | undefined): { dot: string; chip: string } {
  switch (state) {
    case "AVAILABLE":
      return { dot: "bg-success", chip: "bg-success/10 text-success" };
    case "LOW":
      return { dot: "bg-warning", chip: "bg-warning/15 text-warning" };
    default:
      return { dot: "bg-muted-foreground", chip: "bg-secondary text-muted-foreground" };
  }
}

/** Capacity label via i18n (advisorV2.capacity.*). */
export function capacityLabel(state: string | null | undefined, locale: Locale = "en"): string {
  const key = state === "AVAILABLE" ? "advisorV2.capacity.available" : state === "LOW" ? "advisorV2.capacity.low" : "advisorV2.capacity.high";
  return t(key, locale);
}

/** Latest metric row per key (periodStart desc already applied server-side). */
export function latestMetricsByKey<T extends EntityMetricRow>(metrics: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const m of metrics) {
    const cur = map.get(m.metricKey);
    if (!cur || m.periodStart > cur.periodStart) map.set(m.metricKey, m);
  }
  return map;
}

/** Median of numeric array (null-safe, empty → null). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Relative time label ("3 days ago"); null-safe. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
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

/**
 * Payment-plan structure signature derived from published installments:
 * { booking %, duringConstruction %, onHandover %, postHandover % }.
 * Classification: month 0 → booking; month > 36 or label "post-handover" →
 * post-handover; label matching /handover/i → handover; else construction.
 * Derived, honest — surfaced as "derived from published schedules".
 */
export function planStructure(
  installments: { label: string; percent: number; dueOffsetMonths: number | null }[]
): { booking: number; duringConstruction: number; onHandover: number; postHandover: number } {
  const out = { booking: 0, duringConstruction: 0, onHandover: 0, postHandover: 0 };
  for (const i of installments) {
    const label = (i.label ?? "").toLowerCase();
    if (/post[- ]?handover/.test(label) || (i.dueOffsetMonths !== null && i.dueOffsetMonths > 36)) out.postHandover += i.percent;
    else if (i.dueOffsetMonths === 0) out.booking += i.percent;
    else if (/handover/.test(label)) out.onHandover += i.percent;
    else out.duringConstruction += i.percent;
  }
  return out;
}

/** Format a plan structure as "20 / 40 / 30 / 10" style segments string. */
export function planStructureSegments(s: { booking: number; duringConstruction: number; onHandover: number; postHandover: number }): string {
  return [s.booking, s.duringConstruction, s.onHandover, s.postHandover].map((n) => Math.round(n)).join(" / ");
}

/** Deterministic short month-year label ("2025-08" → "Aug 25"). */
export function monthLabel(month: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || !months[idx]) return month;
  return `${months[idx]} ${y.slice(2)}`;
}

/** Deduplicate FAQ rows by question (seed re-runs duplicate group entries). */
export function dedupeFaqs(rows: { id: string; groupKey: string; question: string; answer: string }[]) {
  const seen = new Set<string>();
  return rows.filter((f) => {
    if (seen.has(f.question)) return false;
    seen.add(f.question);
    return true;
  });
}

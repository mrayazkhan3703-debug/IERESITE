/**
 * AI Advisor structured attachments (V2 §22.4/§22.5).
 *
 * Server-side builders that turn tool results into a typed `attachments` array
 * on the advisor turn result. The model's prose answer and the structured
 * attachments coexist — facts stay grounded in tool output, the UI renders
 * them as cards/tables/timelines instead of forcing everything into prose.
 *
 * Protocol rules:
 *  - Attachments are ADDITIVE to the message protocol. Old clients (and the
 *    persisted conversation history) simply have no attachments — rendering
 *    must tolerate that (V1 compatibility).
 *  - Every attachment carries `source` metadata (presentation state +
 *    freshness) so the UI can render the §22.5 "Sources · freshness" line.
 *  - Attachments never contain data the tool did not return — no invention.
 *  - Mirror of the client-side type definitions lives in
 *    src/components/advisor/attachments.tsx (V1 pattern: the client never
 *    imports server modules).
 */
import { resolveMetricState, type MetricState } from "@/lib/data-state";
import { SCENARIO_ENGINE_VERSION } from "@/lib/scenario-engine";

export interface AttachmentSource {
  /** Presentation state for the DataStateBadge (§37 machine). */
  state: MetricState;
  /** Freshness label — ISO date or human-readable "as of" for the title attr. */
  asOf?: string | null;
  /** Optional publisher/methodology note. */
  note?: string | null;
}

function sourceFromProvenance(
  provenance: Parameters<typeof resolveMetricState>[0],
  asOf?: Date | string | null
): AttachmentSource {
  return {
    state: resolveMetricState(provenance),
    asOf: asOf ? (asOf instanceof Date ? asOf.toISOString() : String(asOf)) : null,
  };
}

export interface PropertyCardAttachment {
  kind: "property_card";
  slug: string;
  title: string;
  community: string;
  project: string | null;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceAed: number;
  availability: string;
  offPlan: boolean;
  coverUrl?: string | null;
  url: string;
  source: AttachmentSource;
}

export interface ProjectCardAttachment {
  kind: "project_card";
  slug: string;
  name: string;
  developer: string | null;
  community: string | null;
  status: string;
  handoverDate: string | null;
  completionPercent: number | null;
  startingPriceAed: number | null;
  url: string;
  source: AttachmentSource;
}

export interface CommunityCardAttachment {
  kind: "community_card";
  slug: string;
  name: string;
  summary: string | null;
  avgPricePerSqftAed: number | null;
  url: string;
  source: AttachmentSource;
}

export interface ComparisonTableAttachment {
  kind: "comparison_table";
  title: string;
  /** Entity names (table columns). */
  columns: string[];
  /** Pre-formatted metric rows — deterministic server-side formatting. */
  rows: { metric: string; cells: string[] }[];
  /** Optional per-column detail URLs. */
  urls: (string | null)[];
  source: AttachmentSource;
}

export interface PaymentTimelineAttachment {
  kind: "payment_timeline";
  purchasePriceAed: number;
  stages: { name: string; percent: number; amount: number; cumulative: number; dueLabel: string }[];
  valid: boolean;
  totalPercent: number;
  validationErrors: string[];
  engineVersion: string;
  source: AttachmentSource;
}

export interface ScenarioAttachment {
  kind: "scenario";
  metric: "roi";
  purchasePriceAed: number;
  annualRentAed: number;
  horizonYears: number;
  irrPct: number | null;
  breakEvenYear: number | null;
  scenarios: {
    key: "downside" | "base" | "upside";
    netYieldPct: number;
    totalReturnAed: number;
    totalReturnPct: number;
  }[];
  engineVersion: string;
  source: AttachmentSource;
}

export interface SourceCardAttachment {
  kind: "source_card";
  title: string;
  trustTier?: string | null;
  verifiedAt?: string | null;
  url?: string | null;
  excerpt?: string | null;
  source: AttachmentSource;
}

export type AdvisorAttachment =
  | PropertyCardAttachment
  | ProjectCardAttachment
  | CommunityCardAttachment
  | ComparisonTableAttachment
  | PaymentTimelineAttachment
  | ScenarioAttachment
  | SourceCardAttachment;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

/* ------------------------------------------------------------------ *
 * Builders — one per tool result shape. Every value comes straight
 * from the tool's own data; missing values stay null (no invention).
 * ------------------------------------------------------------------ */

/** search_properties / lookup_property results → property cards. */
export function propertyCards(data: {
  properties?: unknown[];
}): PropertyCardAttachment[] {
  if (!Array.isArray(data.properties)) return [];
  return (data.properties as Record<string, unknown>[]).slice(0, 6).map((m) => ({
    kind: "property_card" as const,
    slug: String(m.slug ?? ""),
    title: String(m.title ?? "Untitled"),
    community: String(m.community ?? "—"),
    project: str(m.project),
    propertyType: String(m.propertyType ?? ""),
    bedrooms: Number(m.bedrooms ?? 0),
    bathrooms: Number(m.bathrooms ?? 0),
    areaSqft: num(m.areaSqft),
    priceAed: Number(m.priceAed ?? 0),
    availability: String(m.availability ?? ""),
    offPlan: Boolean(m.offPlan),
    coverUrl: str(m.coverUrl),
    url: String(m.url ?? `/properties/${m.slug ?? ""}`),
    source: sourceFromProvenance(
      { sourceType: str(m.sourceType), isDemoData: m.isDemoData == null ? null : Boolean(m.isDemoData) },
      str(m.listingUpdatedAt) ?? str(m.sourceUpdatedAt)
    ),
  }));
}

/** lookup_project result → project card. */
export function projectCard(data: Record<string, unknown>): ProjectCardAttachment | null {
  if (!str(data.slug)) return null;
  return {
    kind: "project_card",
    slug: String(data.slug),
    name: String(data.name ?? data.slug),
    developer: str(data.developer),
    community: str(data.community),
    status: str(data.status) ?? "",
    handoverDate: str(data.handoverDate),
    completionPercent: num(data.completionPercent),
    startingPriceAed: num(data.startingPriceAed),
    url: String(data.url ?? `/projects/${data.slug}`),
    source: sourceFromProvenance(
      { sourceType: str(data.sourceType), isDemoData: data.isDemoData == null ? null : Boolean(data.isDemoData) },
      str(data.sourceVerifiedAt) ?? str(data.sourceUpdatedAt)
    ),
  };
}

/** lookup_community result → community card. */
export function communityCard(data: Record<string, unknown>): CommunityCardAttachment | null {
  if (!str(data.slug)) return null;
  return {
    kind: "community_card",
    slug: String(data.slug),
    name: String(data.name ?? data.slug),
    summary: str(data.summary),
    avgPricePerSqftAed: num(data.avgPricePerSqftAed),
    url: String(data.url ?? `/communities/${data.slug}`),
    source: sourceFromProvenance(
      { sourceType: str(data.sourceType), isDemoData: data.isDemoData == null ? null : Boolean(data.isDemoData) },
      str(data.updatedAt)
    ),
  };
}

/** Community comparison table from ≥2 community snapshots (§22.4 comparison_table). */
export function communityComparison(
  communities: { name: string; slug: string; url: string; metrics: Record<string, { value: number | null; unit: string; sourceName: string | null; periodStart: string | null; retrievedAt: string | null; isIllustrative: boolean | null }> }[]
): ComparisonTableAttachment | null {
  if (communities.length < 2) return null;
  const fmtAED = (v: number | null) =>
    v == null ? "Not provided" : `AED ${Math.round(v).toLocaleString("en-US")}`;
  const metricRows: { metric: string; key: string; format: (v: number | null) => string }[] = [
    { metric: "Median transaction price", key: "MEDIAN_TRANS_PRICE", format: fmtAED },
    { metric: "Avg price / sqft", key: "AVG_PRICE_PER_SQFT", format: (v) => (v == null ? "Not provided" : `AED ${Math.round(v).toLocaleString("en-US")}`) },
    { metric: "Avg 1BR rent (yearly)", key: "AVG_RENT_1BR", format: fmtAED },
    { metric: "Modeled gross yield", key: "YIELD_PCT", format: (v) => (v == null ? "Not provided" : `${v.toFixed(2)}%`) },
    { metric: "Transactions (period)", key: "TRANSACTION_COUNT", format: (v) => (v == null ? "Not provided" : Math.round(v).toLocaleString("en-US")) },
  ];
  const rows = metricRows
    .map(({ metric, key, format }) => ({
      metric,
      cells: communities.map((c) => format(c.metrics[key]?.value ?? null)),
    }))
    .filter((r) => r.cells.some((c) => c !== "Not provided"));
  if (!rows.length) return null;
  // Freshest retrievedAt across included metrics drives the table source line.
  const retrieved = communities
    .flatMap((c) => Object.values(c.metrics).map((m) => m.retrievedAt))
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;
  const illustrative = communities.some((c) => Object.values(c.metrics).some((m) => m.isIllustrative));
  return {
    kind: "comparison_table",
    title: "Community comparison — latest sourced metrics",
    columns: communities.map((c) => c.name),
    rows,
    urls: communities.map((c) => c.url),
    source: {
      state: illustrative ? "ILLUSTRATIVE" : "VERIFIED_SOURCE",
      asOf: retrieved,
      note: illustrative ? "Illustrative model figures (dev)" : null,
    },
  };
}

/** calculate_payment_plan result → timeline attachment. */
export function paymentTimeline(data: Record<string, unknown>): PaymentTimelineAttachment | null {
  if (!Array.isArray(data.timeline)) return null;
  return {
    kind: "payment_timeline",
    purchasePriceAed: num(data.purchasePrice) ?? 0,
    stages: (data.timeline as Record<string, unknown>[]).map((s) => ({
      name: String(s.name ?? ""),
      percent: Number(s.percent ?? 0),
      amount: Number(s.amount ?? 0),
      cumulative: Number(s.cumulative ?? 0),
      dueLabel: String(s.dueLabel ?? ""),
    })),
    valid: Boolean(data.valid),
    totalPercent: Number(data.totalPercent ?? 0),
    validationErrors: Array.isArray(data.validationErrors) ? (data.validationErrors as string[]).map(String) : [],
    engineVersion: String(data.engineVersion ?? SCENARIO_ENGINE_VERSION),
    source: { state: "MODELED", asOf: null, note: "Deterministic scenario-engine calculation" },
  };
}

/** calculate_roi result → downside/base/upside scenario attachment. */
export function roiScenario(data: Record<string, unknown>): ScenarioAttachment | null {
  const sc = data.scenarios as Record<string, Record<string, unknown>> | undefined;
  if (!sc || !sc.base) return null;
  const keys = ["downside", "base", "upside"] as const;
  return {
    kind: "scenario",
    metric: "roi",
    purchasePriceAed: num(data.purchasePrice) ?? 0,
    annualRentAed: num(data.annualRent) ?? 0,
    horizonYears: num(data.years) ?? 5,
    irrPct: num(data.irrPct),
    breakEvenYear: num(data.breakEvenYear),
    scenarios: keys.map((key) => ({
      key,
      netYieldPct: Number(sc[key]?.netYieldPct ?? 0),
      totalReturnAed: Number(sc[key]?.totalReturn ?? 0),
      totalReturnPct: Number(sc[key]?.totalReturnPct ?? 0),
    })),
    engineVersion: String(data.engineVersion ?? SCENARIO_ENGINE_VERSION),
    source: {
      state: "MODELED",
      asOf: null,
      note: "Projections from the deterministic scenario engine — not guaranteed returns",
    },
  };
}

/** search_knowledge passages → source cards. */
export function sourceCards(data: { passages?: unknown[] }): SourceCardAttachment[] {
  if (!Array.isArray(data.passages)) return [];
  return (data.passages as Record<string, unknown>[]).slice(0, 3).map((p) => ({
    kind: "source_card" as const,
    title: String(p.sourceTitle ?? "Source"),
    trustTier: str(p.trustTier),
    verifiedAt: str(p.verifiedAt),
    url: str(p.url),
    excerpt: typeof p.content === "string" ? p.content.slice(0, 180) : null,
    source: sourceFromProvenance(
      { sourcePublisher: str(p.sourceTitle), verificationStatus: str(p.trustTier) },
      str(p.verifiedAt)
    ),
  }));
}

/** Deduplicate attachments by kind + identity key (search + scoped lookup can overlap). */
export function dedupeAttachments(list: AdvisorAttachment[]): AdvisorAttachment[] {
  const seen = new Set<string>();
  const out: AdvisorAttachment[] = [];
  for (const a of list) {
    const key =
      a.kind === "property_card" ? `p:${a.slug}` :
      a.kind === "project_card" ? `j:${a.slug}` :
      a.kind === "community_card" ? `c:${a.slug}` :
      a.kind === "source_card" ? `s:${a.title}` :
      a.kind === "comparison_table" ? `t:${a.title}` :
      a.kind === "payment_timeline" ? `pp:${a.totalPercent}:${a.stages.length}` :
      `sc:${a.purchasePriceAed}:${a.horizonYears}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

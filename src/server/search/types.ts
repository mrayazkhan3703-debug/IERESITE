/**
 * Canonical SearchState — the auditable search plan (blueprint F08).
 * Serialized into URLs, saved searches, and lead context. Deterministic + shareable.
 */
import { z } from "zod";

export const SORT_OPTIONS = [
  "relevance",
  "price_asc",
  "price_desc",
  "newest",
  "area_desc",
  "price_per_sqft_asc",
  "yield_desc",
] as const;

/** §12.6 smart filter keys — every computed filter has a documented methodology. */
export const SMART_FILTER_KEYS = ["below_median", "waterfront", "high_yield", "handover_soon"] as const;
export type SmartFilterKey = (typeof SMART_FILTER_KEYS)[number];

export const searchStateSchema = z.object({
  q: z.string().max(200).optional(),
  listingType: z.enum(["SALE", "RENT", "SHORT_TERM"]).default("SALE"),
  propertyTypes: z.array(z.string()).max(12).optional(),
  communities: z.array(z.string()).max(12).optional(), // slugs
  developers: z.array(z.string()).max(12).optional(), // slugs
  projects: z.array(z.string()).max(12).optional(), // slugs
  agents: z.array(z.string()).max(12).optional(),
  priceMin: z.number().int().min(0).max(500_000_000).optional(), // AED whole units
  priceMax: z.number().int().min(0).max(500_000_000).optional(),
  bedroomsMin: z.number().int().min(0).max(20).optional(),
  bedroomsMax: z.number().int().min(0).max(20).optional(),
  bathroomsMin: z.number().int().min(0).max(20).optional(),
  areaMin: z.number().int().min(0).max(100_000).optional(),
  areaMax: z.number().int().min(0).max(100_000).optional(),
  amenities: z.array(z.string()).max(20).optional(),
  offPlan: z.boolean().optional(),
  furnished: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  featured: z.boolean().optional(),
  availability: z.array(z.string()).max(6).optional(),
  projectStatus: z.array(z.string()).max(6).optional(),
  paymentPlanMaxDown: z.number().int().min(0).max(100).optional(), // booking+down payment percent cap
  handoverBy: z.string().optional(), // quarter or date "Q4 2027"
  /* V2 §12.3 additions (U04) — additive, all optional. */
  views: z.array(z.string()).max(6).optional(), // SEA|MARINA|SKYLINE|GOLF|PARK|COMMUNITY
  furnishings: z.array(z.string()).max(4).optional(), // FURNISHED|SEMI_FURNISHED|UNFURNISHED
  ppsfMin: z.number().int().min(0).max(100_000).optional(), // AED/sqft asking
  ppsfMax: z.number().int().min(0).max(100_000).optional(),
  yieldMin: z.number().min(0).max(25).optional(), // community modeled gross yield %
  handoverFromYear: z.number().int().min(2000).max(2100).optional(),
  handoverToYear: z.number().int().min(2000).max(2100).optional(),
  postHandoverPlan: z.boolean().optional(), // project payment plan includes post-handover installments
  smart: z.array(z.enum(SMART_FILTER_KEYS)).max(8).optional(),
  sort: z.enum(SORT_OPTIONS).default("relevance"),
  page: z.number().int().min(1).max(500).default(1),
  pageSize: z.number().int().min(1).max(48).default(12),
  bbox: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]).refine(([w, s, e, n]) => w < e && s < n, "Use an ordered west,south,east,north bounding box.").optional(),
  radiusKm: z.number().min(0.1).max(200).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  polygon: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(3)
    .max(100)
    .optional(), // [lng, lat] vertices; server closes the ring
});

export type SearchState = z.infer<typeof searchStateSchema>;

export interface IndexedProperty {
  id: string; // listing id
  propertyId: string;
  slug: string;
  title: string;
  listingType: string;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: bigint;
  currency: string;
  priceQualifier: string | null;
  rentFrequency: string | null;
  availabilityStatus: string;
  offPlan: boolean;
  isFeatured: boolean;
  isExclusive: boolean;
  furnished: boolean;
  communityId: string;
  communityName: string;
  communitySlug: string;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  projectStatus: string | null;
  developerId: string | null;
  developerName: string | null;
  developerSlug: string | null;
  agentId: string | null;
  agentSlug: string | null;
  amenities: string[];
  lat: number;
  lng: number;
  publishedAt: number | null;
  handoverQuarter: string | null;
  view: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  paymentPlanDownPercent: number | null;
  isDemoData: boolean;
  tokens: Set<string>;
  /* V2 §12 additions (U04) — additive doc fields for the new filters/sorts. */
  furnishing: string | null; // raw FURNISHED|SEMI_FURNISHED|UNFURNISHED
  communityAreaType: string; // RESIDENTIAL|WATERFRONT|ISLAND|...
  communityAvgPsqft: number | null; // latest modeled AVG_PRICE_PER_SQFT (AED major)
  communityYieldPct: number | null; // latest modeled YIELD_PCT
  paymentPlanPostHandover: boolean | null; // any project payment plan with postHandover=true
}

export interface FacetCounts {
  communities: Map<string, number>; // slug → count
  propertyTypes: Map<string, number>;
  developers: Map<string, number>;
  bedrooms: Map<number, number>;
  amenities: Map<string, number>;
  views: Map<string, number>; // V2 §12.3 (U04)
  priceBuckets: { key: string; min: number; max: number | null; count: number }[];
}

export interface SearchResult {
  ids: string[]; // listing ids
  total: number;
  facets: FacetCounts;
  tookMs: number;
}

export interface SearchProvider {
  readonly name: string;
  upsert(doc: IndexedProperty): void;
  remove(listingId: string): void;
  clear(): void;
  size(): number;
  search(state: SearchState): SearchResult;
  autocomplete(prefix: string, limit?: number): AutocompleteItem[];
  geoSearch(bbox: [number, number, number, number], state: SearchState): SearchResult;
}

export interface AutocompleteItem {
  kind: "community" | "project" | "developer" | "property";
  label: string;
  sublabel?: string;
  slug: string;
  count?: number;
}

/* URL <-> SearchState ------------------------------------------------------ */

export function searchStateToQuery(state: SearchState): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  };
  put("q", state.q);
  put("type", state.listingType !== "SALE" ? state.listingType.toLowerCase() : undefined);
  put("propertyType", state.propertyTypes);
  put("community", state.communities);
  put("developer", state.developers);
  put("project", state.projects);
  put("agent", state.agents);
  put("priceMin", state.priceMin);
  put("priceMax", state.priceMax);
  put("bedsMin", state.bedroomsMin);
  put("bedsMax", state.bedroomsMax);
  put("bathsMin", state.bathroomsMin);
  put("areaMin", state.areaMin);
  put("areaMax", state.areaMax);
  put("amenities", state.amenities);
  put("views", state.views);
  put("furnishing", state.furnishings);
  put("ppsfMin", state.ppsfMin);
  put("ppsfMax", state.ppsfMax);
  put("yieldMin", state.yieldMin);
  put("handoverFrom", state.handoverFromYear);
  put("handoverTo", state.handoverToYear);
  put("postHandover", state.postHandoverPlan === true ? "1" : state.postHandoverPlan === false ? "0" : undefined);
  put("paymentPlanMaxDown", state.paymentPlanMaxDown);
  put("handoverBy", state.handoverBy);
  put("smart", state.smart);
  put("offPlan", state.offPlan === true ? "1" : state.offPlan === false ? "0" : undefined);
  put("furnished", state.furnished === true ? "1" : state.furnished === false ? "0" : undefined);
  put("exclusive", state.exclusive === true ? "1" : undefined);
  put("featured", state.featured === true ? "1" : undefined);
  put("availability", state.availability);
  put("status", state.projectStatus);
  put("sort", state.sort !== "relevance" ? state.sort : undefined);
  put("page", state.page !== 1 ? state.page : undefined);
  put("pageSize", state.pageSize !== 12 ? state.pageSize : undefined);
  put("bbox", state.bbox?.join(","));
  put("radiusKm", state.radiusKm);
  put("centerLat", state.centerLat);
  put("centerLng", state.centerLng);
  put("polygon", state.polygon?.map(([lng, lat]) => `${lng}:${lat}`).join(";"));
  return out;
}

export function queryToSearchState(query: Record<string, string>): SearchState {
  const raw: Record<string, unknown> = {};
  const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
  const arr = (v: string | undefined) => (v ? v.split(",").filter(Boolean).slice(0, 12) : undefined);

  raw.q = query.q?.slice(0, 200) || undefined;
  // listingType: explicit legacy `type` wins, then V2 `mode` (additive), default SALE
  raw.listingType =
    (query.type?.toUpperCase() as "SALE" | "RENT" | "SHORT_TERM") ||
    (query.mode === "rent" ? "RENT" : "SALE");
  raw.propertyTypes = arr(query.propertyType);
  raw.communities = arr(query.community);
  raw.developers = arr(query.developer);
  raw.projects = arr(query.project);
  raw.agents = arr(query.agent);
  raw.priceMin = num(query.priceMin);
  raw.priceMax = num(query.priceMax);
  raw.bedroomsMin = num(query.bedsMin);
  raw.bedroomsMax = num(query.bedsMax);
  raw.bathroomsMin = num(query.bathsMin);
  raw.areaMin = num(query.areaMin);
  raw.areaMax = num(query.areaMax);
  raw.amenities = arr(query.amenities);
  raw.views = arr(query.views);
  raw.furnishings = arr(query.furnishing);
  raw.ppsfMin = num(query.ppsfMin);
  raw.ppsfMax = num(query.ppsfMax);
  raw.yieldMin = num(query.yieldMin);
  raw.handoverFromYear = num(query.handoverFrom);
  raw.handoverToYear = num(query.handoverTo);
  raw.postHandoverPlan = query.postHandover === "1" ? true : query.postHandover === "0" ? false : undefined;
  raw.paymentPlanMaxDown = num(query.paymentPlanMaxDown);
  raw.handoverBy = query.handoverBy || undefined;
  raw.smart = query.smart
    ? query.smart.split(",").filter((v): v is SmartFilterKey => (SMART_FILTER_KEYS as readonly string[]).includes(v))
    : undefined;
  raw.offPlan = query.offPlan === "1" ? true : query.mode === "offplan" && query.offPlan === undefined ? true : query.offPlan === "0" ? false : undefined;
  raw.furnished = query.furnished === "1" ? true : query.furnished === "0" ? false : undefined;
  raw.exclusive = query.exclusive === "1" ? true : undefined;
  raw.featured = query.featured === "1" ? true : undefined;
  raw.availability = arr(query.availability);
  raw.projectStatus = arr(query.status);
  raw.sort = query.sort || "relevance";
  raw.page = num(query.page) || 1;
  raw.pageSize = num(query.pageSize) || 12;
  if (query.bbox) {
    const parts = query.bbox.split(",").map(Number);
    raw.bbox = parts;
  }
  raw.radiusKm = num(query.radiusKm);
  raw.centerLat = num(query.centerLat);
  raw.centerLng = num(query.centerLng);
  if (query.polygon) {
    const points = query.polygon.split(";").map((point) => point.split(":").map(Number));
    if (points.length >= 3 && points.every((point) => point.length === 2 && point.every(Number.isFinite))) {
      raw.polygon = points;
    }
  }
  return searchStateSchema.parse(raw);
}

export function serializeSearchState(state: SearchState): string {
  return JSON.stringify(searchStateToQuery(state));
}

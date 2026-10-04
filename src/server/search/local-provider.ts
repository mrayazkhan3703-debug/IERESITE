/**
 * LocalSearchProvider — the in-process search index (ADR-002 development path).
 *
 * Design contract (blueprint F06): the index is a REBUILDABLE PROJECTION of the
 * canonical database — the DB is the source of truth, never this object. All
 * state lives in plain in-memory Maps: listing docs keyed by listing id, a
 * property→listings reverse map (for outbox-driven reindex of a whole
 * property), and a tokenized inverted index (token → listing ids) that powers
 * keyword queries with bounded Damerau-Levenshtein typo tolerance.
 *
 * The production swap (SEARCH_PROVIDER=typesense) implements the same
 * SearchProvider interface, so behavior here must stay deterministic and
 * side-effect free: no persistence, no clocks inside scoring (the only clock
 * reads are tookMs instrumentation and the documented handover-soon window).
 */
import type {
  AutocompleteItem,
  FacetCounts,
  IndexedProperty,
  SearchProvider,
  SearchState,
  InventorySearchState,
  SearchResult,
  SmartFilterKey,
} from "./types";

/* --------------------------- Tokenization --------------------------------- */

/**
 * Canonical Unicode tokenizer shared by the search index and RAG pipeline (Q24):
 * lowercase, retain letter/number/combining-mark sequences, drop single base characters. Must stay
 * byte-for-byte consistent with the token Set the search service builds per
 * document — a mismatch would silently break keyword matching.
 */
export function tokenize(text: string): string[] {
  const tokens = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  return tokens.filter((token) => [...token].filter((character) => !/\p{M}/u.test(character)).length > 1);
}

/**
 * Bounded edit distance (Damerau-Levenshtein, optimal-string-alignment
 * variant): true when a→b needs at most `k` single edits (insert, delete,
 * substitute, or adjacent transposition). Row-minimum early exit keeps the
 * cost near O(len·k) for non-matches.
 */
export function editDistanceWithin(a: string, b: string, k: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > k) return false;
  let prevPrev: number[] | null = null; // row i-2 (transposition lookback)
  let prev: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prevPrev as number[])[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return false; // no cell in this row can recover
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length] <= k;
}

/* ------------------------- Domain constants ------------------------------- */

/** Sale price buckets in AED MAJOR units; the final open bucket guarantees
 *  every listing falls into exactly one bucket (facet sums must equal total). */
const PRICE_BUCKETS: { key: string; min: number; max: number | null }[] = [
  { key: "0-1000000", min: 0, max: 1_000_000 },
  { key: "1000000-2000000", min: 1_000_000, max: 2_000_000 },
  { key: "2000000-5000000", min: 2_000_000, max: 5_000_000 },
  { key: "5000000-10000000", min: 5_000_000, max: 10_000_000 },
  { key: "10000000-plus", min: 10_000_000, max: null },
];

/** §12.6 smart-filter methodology constants (mirrors the UI dialog text). */
const HIGH_YIELD_THRESHOLD_PCT = 6; // community modeled gross yield ≥ 6%/yr
const HANDOVER_SOON_HORIZON_MS = 365.25 * 24 * 3600 * 1000; // next 12 months
/** Waterfront derivation keywords — disclosed as "derived from community name". */
const WATERFRONT_NAME_KEYWORDS = [
  "waterfront", "marina", "beach", "palm", "island", "sea", "bay", "crescent", "quay", "lagoon",
];
/** Recorded community area types that count as waterfront. */
const WATERFRONT_AREA_TYPES = new Set(["WATERFRONT", "ISLAND"]);

/** Minimum token length before typo tolerance kicks in (short tokens are too
 *  ambiguous to fuzzy-match honestly). */
const TYPO_TOLERANCE_MIN_LEN = 4;
/** Weight of a fuzzy (one-edit) token match relative to an exact match. */
const FUZZY_TOKEN_WEIGHT = 0.6;

interface QuarterRef {
  year: number;
  quarter: number; // 1-4
  index: number; // year*4 + (quarter-1) — total order
  startMs: number; // UTC start of the quarter
  endMs: number; // UTC end (exclusive)
}

/** Parse "Q4 2027"-style handover quarters (also "Q4-2027", any case). */
function parseQuarter(raw: string | null | undefined): QuarterRef | null {
  if (!raw) return null;
  const m = /^q([1-4])[\s-]+(\d{4})$/i.exec(raw.trim());
  if (!m) return null;
  const quarter = Number(m[1]);
  const year = Number(m[2]);
  const startMs = Date.UTC(year, (quarter - 1) * 3, 1);
  return { year, quarter, index: year * 4 + (quarter - 1), startMs, endMs: Date.UTC(year, (quarter - 1) * 3 + 3, 1) };
}

/**
 * Parse a handoverBy bound ("Q4 2027", an ISO date, or a bare year) into the
 * quarter it denotes. Quarters compare by index; a date maps to its containing
 * quarter ("before 2027-12-01" ≙ "by Q4 2027" at quarter granularity).
 */
function parseHandoverBound(raw: string): QuarterRef | null {
  const asQuarter = parseQuarter(raw);
  if (asQuarter) return asQuarter;
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) return parseQuarter(`Q4 ${trimmed}`);
  const ts = Date.parse(trimmed);
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return parseQuarter(`Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`);
}

/** Great-circle distance in kilometers (standard haversine). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Asking price in AED major units (docs store minor units as BigInt). */
function priceAed(doc: IndexedProperty): number {
  return Number(doc.priceMinor) / 100;
}

/** Asking AED/sqft — null when area is unknown (never fabricated). */
function ppsfAed(doc: IndexedProperty): number | null {
  if (doc.areaSqft === null || doc.areaSqft <= 0) return null;
  return priceAed(doc) / doc.areaSqft;
}

/* --------------------------- The provider ---------------------------------- */

/** Scored match carried through the sort/paginate pipeline. */
interface Match {
  doc: IndexedProperty;
  score: number; // 0..1 relevance (token score); 0 when no q
}

export class LocalSearchProvider implements SearchProvider {
  readonly name = "local";

  /** listing id → document */
  private docs = new Map<string, IndexedProperty>();
  /** property id → listing ids (reverse map for whole-property reindex) */
  private propertyToListings = new Map<string, Set<string>>();
  /** token → listing ids (inverted index) */
  private inverted = new Map<string, Set<string>>();

  /* ---------------------------- maintenance ------------------------------ */

  upsert(doc: IndexedProperty): void {
    // Remove any previous version first so stale tokens/property links can
    // never linger — upsert is idempotent and order-independent.
    this.remove(doc.id);
    const stored: IndexedProperty = { ...doc, tokens: new Set(doc.tokens) };
    this.docs.set(doc.id, stored);

    let listings = this.propertyToListings.get(stored.propertyId);
    if (!listings) {
      listings = new Set<string>();
      this.propertyToListings.set(stored.propertyId, listings);
    }
    listings.add(stored.id);

    for (const token of stored.tokens) {
      let ids = this.inverted.get(token);
      if (!ids) {
        ids = new Set<string>();
        this.inverted.set(token, ids);
      }
      ids.add(stored.id);
    }
  }

  remove(listingId: string): void {
    const doc = this.docs.get(listingId);
    if (!doc) return;
    for (const token of doc.tokens) {
      const ids = this.inverted.get(token);
      if (ids) {
        ids.delete(listingId);
        if (!ids.size) this.inverted.delete(token);
      }
    }
    const listings = this.propertyToListings.get(doc.propertyId);
    if (listings) {
      listings.delete(listingId);
      if (!listings.size) this.propertyToListings.delete(doc.propertyId);
    }
    this.docs.delete(listingId);
  }

  /** Outbox path: a property that vanished from the DB takes its listings
   *  (there can be more than one listing row per property) out of the index. */
  removeByProperty(propertyId: string): void {
    const listings = this.propertyToListings.get(propertyId);
    if (!listings) return;
    for (const id of [...listings]) this.remove(id);
  }

  clear(): void {
    this.docs.clear();
    this.inverted.clear();
    this.propertyToListings.clear();
  }

  size(): number {
    return this.docs.size;
  }

  /** Docs for the given listing ids, in the requested order (missing skipped). */
  getDocs(ids: string[]): IndexedProperty[] {
    const out: IndexedProperty[] = [];
    for (const id of ids) {
      const doc = this.docs.get(id);
      if (doc) out.push(doc);
    }
    return out;
  }

  /** Community list derived from current docs — count = live listings. */
  communityList(): { id: string; name: string; slug: string; count: number }[] {
    const bySlug = new Map<string, { id: string; name: string; slug: string; count: number }>();
    for (const doc of this.docs.values()) {
      const existing = bySlug.get(doc.communitySlug);
      if (existing) existing.count++;
      else bySlug.set(doc.communitySlug, { id: doc.communityId, name: doc.communityName, slug: doc.communitySlug, count: 1 });
    }
    return [...bySlug.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /* ------------------------------ querying ------------------------------- */

  search(state: InventorySearchState): SearchResult {
    const startedAt = performance.now();

    // Token scores come from the inverted index (exact hits weight 1, one-edit
    // typo hits 0.6 — same convention as the RAG hybrid retrieval).
    const queryTokens = state.q ? tokenize(state.q) : [];
    const tokenScores = queryTokens.length ? this.scoreTokens(queryTokens) : null;

    const matches: Match[] = [];
    for (const doc of this.docs.values()) {
      if (!this.passesFilters(doc, state)) continue;
      const score = tokenScores ? tokenScores.get(doc.id) ?? 0 : 0;
      if (tokenScores && score <= 0) continue; // q is a filter, not just a ranker
      matches.push({ doc, score });
    }

    this.sortMatches(matches, state.sort ?? "relevance");

    // Facets are computed over ALL matching docs (never just the page) so the
    // UI can render counts that reconcile with `total`.
    const facets = this.buildFacets(matches);

    const page = Math.max(1, state.page ?? 1);
    const pageSize = Math.min(48, Math.max(1, state.pageSize ?? 12));
    const offset = (page - 1) * pageSize;
    const ids = matches.slice(offset, offset + pageSize).map((m) => m.doc.id);

    return { ids, total: matches.length, facets, tookMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  }

  /** Map view contract: restrict to the bounding box, then run the exact same
   *  filter/sort/paginate pipeline (list + map stay consistent by construction). */
  geoSearch(bbox: [number, number, number, number], state: SearchState): SearchResult {
    return this.search({ ...state, bbox });
  }

  autocomplete(prefix: string, limit = 8): AutocompleteItem[] {
    const p = prefix.trim().toLowerCase();
    if (!p) return [];
    // Prefix matches at the start of the label or at the start of any word in
    // it ("mar" matches both "Marina Quay" and "Dubai Marina").
    const labelMatches = (label: string): boolean => {
      const l = label.toLowerCase();
      return l.startsWith(p) || l.split(/[^a-z0-9]+/).some((tok) => tok.startsWith(p));
    };

    const communities = new Map<string, { name: string; count: number }>();
    const projects = new Map<string, { name: string; count: number }>();
    const developers = new Map<string, { name: string; count: number }>();
    const properties: IndexedProperty[] = [];
    for (const doc of this.docs.values()) {
      const c = communities.get(doc.communitySlug);
      if (c) c.count++;
      else communities.set(doc.communitySlug, { name: doc.communityName, count: 1 });
      if (doc.projectSlug && doc.projectName) {
        const pr = projects.get(doc.projectSlug);
        if (pr) pr.count++;
        else projects.set(doc.projectSlug, { name: doc.projectName, count: 1 });
      }
      if (doc.developerSlug && doc.developerName) {
        const d = developers.get(doc.developerSlug);
        if (d) d.count++;
        else developers.set(doc.developerSlug, { name: doc.developerName, count: 1 });
      }
      properties.push(doc);
    }

    const items: AutocompleteItem[] = [];
    for (const [slug, c] of communities) {
      if (labelMatches(c.name)) items.push({ kind: "community", label: c.name, sublabel: "Community", slug, count: c.count });
    }
    for (const [slug, pr] of projects) {
      if (labelMatches(pr.name)) items.push({ kind: "project", label: pr.name, sublabel: "Project", slug, count: pr.count });
    }
    for (const [slug, d] of developers) {
      if (labelMatches(d.name)) items.push({ kind: "developer", label: d.name, sublabel: "Developer", slug, count: d.count });
    }
    for (const doc of properties) {
      if (labelMatches(doc.title)) items.push({ kind: "property", label: doc.title, sublabel: doc.communityName, slug: doc.slug });
    }

    // Deterministic ranking: listing count desc, then label asc.
    items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
    return items.slice(0, Math.max(1, limit));
  }

  /* ------------------------------ internals ------------------------------ */

  /** listing id → relevance score in [0,1] via the inverted index. */
  private scoreTokens(queryTokens: string[]): Map<string, number> {
    const raw = new Map<string, number>();
    for (const qt of queryTokens) {
      const exact = this.inverted.get(qt);
      if (exact) {
        for (const id of exact) raw.set(id, (raw.get(id) ?? 0) + 1);
        continue;
      }
      if (qt.length < TYPO_TOLERANCE_MIN_LEN) continue;
      // Typo tolerance: scan the vocabulary with a bounded one-edit distance.
      // The same first-char + length-delta guards as the RAG pipeline keep the
      // scan cheap and avoid absurd near-matches on short tokens.
      for (const [term, ids] of this.inverted) {
        if (
          term.length >= TYPO_TOLERANCE_MIN_LEN &&
          Math.abs(term.length - qt.length) <= 1 &&
          term[0] === qt[0] &&
          editDistanceWithin(term, qt, 1)
        ) {
          for (const id of ids) raw.set(id, (raw.get(id) ?? 0) + FUZZY_TOKEN_WEIGHT);
        }
      }
    }
    for (const [id, sum] of raw) raw.set(id, sum / queryTokens.length);
    return raw;
  }

  /** Every optional SearchState filter — all must pass. Values the document
   *  genuinely lacks (no area, no yield metric, no payment plan) never match
   *  the corresponding filter: honesty over guessing. */
  private passesFilters(doc: IndexedProperty, s: InventorySearchState): boolean {
    if (s.inventoryListingTypes) {
      if (!s.inventoryListingTypes.includes(doc.listingType as SearchState["listingType"])) return false;
    } else if (s.listingType !== undefined && doc.listingType !== s.listingType) return false;

    // Property types arrive lowercased from the public UI and uppercased from
    // the AI tool layer — compare case-insensitively.
    if (s.propertyTypes?.length) {
      const wanted = new Set(s.propertyTypes.map((v) => v.toUpperCase()));
      if (!wanted.has(doc.propertyType.toUpperCase())) return false;
    }

    if (s.communities?.length && !s.communities.includes(doc.communitySlug)) return false;

    // Developers: the filter panel sends facet ids while the schema documents
    // slugs — accept either form so both callers keep working.
    if (s.developers?.length && !idOrSlugMatch(s.developers, doc.developerId, doc.developerSlug)) return false;
    if (s.projects?.length && !idOrSlugMatch(s.projects, doc.projectId, doc.projectSlug)) return false;
    if (s.agents?.length && !idOrSlugMatch(s.agents, doc.agentId, doc.agentSlug)) return false;

    const price = priceAed(doc); // filters are AED major units
    if (s.priceMin !== undefined && price < s.priceMin) return false;
    if (s.priceMax !== undefined && price > s.priceMax) return false;

    if (s.bedroomsMin !== undefined && doc.bedrooms < s.bedroomsMin) return false;
    if (s.bedroomsMax !== undefined && doc.bedrooms > s.bedroomsMax) return false;
    if (s.bathroomsMin !== undefined && doc.bathrooms < s.bathroomsMin) return false;

    if (s.areaMin !== undefined || s.areaMax !== undefined) {
      if (doc.areaSqft === null || doc.areaSqft <= 0) return false;
      if (s.areaMin !== undefined && doc.areaSqft < s.areaMin) return false;
      if (s.areaMax !== undefined && doc.areaSqft > s.areaMax) return false;
    }

    if (s.ppsfMin !== undefined || s.ppsfMax !== undefined) {
      const ppsf = ppsfAed(doc);
      if (ppsf === null) return false;
      if (s.ppsfMin !== undefined && ppsf < s.ppsfMin) return false;
      if (s.ppsfMax !== undefined && ppsf > s.ppsfMax) return false;
    }

    // Amenities are ANY-of: facet counts list per-amenity availability, so
    // selecting several widens (OR), never silently narrows to AND.
    if (s.amenities?.length) {
      const wanted = new Set(s.amenities.map((v) => v.toUpperCase()));
      if (!doc.amenities.some((a) => wanted.has(a.toUpperCase()))) return false;
    }

    if (s.offPlan !== undefined && doc.offPlan !== s.offPlan) return false;
    if (s.furnished !== undefined && doc.furnished !== s.furnished) return false;
    if (s.exclusive !== undefined && doc.isExclusive !== s.exclusive) return false;
    if (s.featured !== undefined && doc.isFeatured !== s.featured) return false;

    if (s.availability?.length) {
      const wanted = new Set(s.availability.map((v) => v.toUpperCase()));
      if (!wanted.has(doc.availabilityStatus.toUpperCase())) return false;
    }
    if (s.projectStatus?.length) {
      const wanted = new Set(s.projectStatus.map((v) => v.toUpperCase()));
      if (!doc.projectStatus || !wanted.has(doc.projectStatus.toUpperCase())) return false;
    }
    if (s.paymentPlanMaxDown !== undefined) {
      if (doc.paymentPlanDownPercent === null || doc.paymentPlanDownPercent > s.paymentPlanMaxDown) return false;
    }

    // "Handover before Q4 2027" — inclusive quarter comparison; listings with
    // no recorded handover quarter never match an explicit handover bound.
    if (s.handoverBy) {
      const bound = parseHandoverBound(s.handoverBy);
      const docQ = parseQuarter(doc.handoverQuarter);
      if (!bound || !docQ || docQ.index > bound.index) return false;
    }

    if (s.views?.length) {
      const wanted = new Set(s.views.map((v) => v.toUpperCase()));
      if (!doc.view || !wanted.has(doc.view.toUpperCase())) return false;
    }
    if (s.furnishings?.length) {
      const wanted = new Set(s.furnishings.map((v) => v.toUpperCase()));
      if (!doc.furnishing || !wanted.has(doc.furnishing.toUpperCase())) return false;
    }

    if (s.yieldMin !== undefined) {
      if (doc.communityYieldPct === null || doc.communityYieldPct < s.yieldMin) return false;
    }

    if (s.handoverFromYear !== undefined || s.handoverToYear !== undefined) {
      const docQ = parseQuarter(doc.handoverQuarter);
      if (!docQ) return false;
      if (s.handoverFromYear !== undefined && docQ.year < s.handoverFromYear) return false;
      if (s.handoverToYear !== undefined && docQ.year > s.handoverToYear) return false;
    }

    if (s.postHandoverPlan !== undefined && doc.paymentPlanPostHandover !== s.postHandoverPlan) return false;

    if (s.smart?.length) {
      for (const key of s.smart) {
        if (!this.passesSmartFilter(doc, key)) return false;
      }
    }

    // Geo: bbox = [w, s, e, n] containment; radius = haversine distance to center.
    if (s.bbox) {
      const [w, south, e, n] = s.bbox;
      if (doc.lng < w || doc.lng > e || doc.lat < south || doc.lat > n) return false;
    }
    if (s.radiusKm !== undefined && s.centerLat !== undefined && s.centerLng !== undefined) {
      if (haversineKm(s.centerLat, s.centerLng, doc.lat, doc.lng) > s.radiusKm) return false;
    }

    return true;
  }

  /** §12.6 smart filters — methodology mirrored in the UI dialog (i18n keys
   *  search.smart.*.tip). Computed server-side so pagination and the map agree. */
  private passesSmartFilter(doc: IndexedProperty, key: SmartFilterKey): boolean {
    switch (key) {
      case "below_median": {
        // Asking AED/sqft strictly below the community's latest modeled average
        // asking AED/sqft. No recorded area or no benchmark → never matches.
        const ppsf = ppsfAed(doc);
        if (ppsf === null || doc.communityAvgPsqft === null) return false;
        return ppsf < doc.communityAvgPsqft;
      }
      case "waterfront": {
        // Derived from the community name keyword table plus the recorded
        // area type — an approximation, disclosed as such in the UI tooltip.
        const name = doc.communityName.toLowerCase();
        const byName = WATERFRONT_NAME_KEYWORDS.some((k) => name.includes(k));
        const byAreaType = WATERFRONT_AREA_TYPES.has(doc.communityAreaType);
        return byName || byAreaType;
      }
      case "high_yield":
        // Community modeled gross yield ≥ 6%/yr (latest market metric).
        return doc.communityYieldPct !== null && doc.communityYieldPct >= HIGH_YIELD_THRESHOLD_PCT;
      case "handover_soon": {
        // Off-plan listings whose recorded handover quarter falls within the
        // next 12 months; quarters already past never match.
        if (!doc.offPlan) return false;
        const q = parseQuarter(doc.handoverQuarter);
        if (!q) return false;
        const now = Date.now();
        return q.endMs > now && q.startMs <= now + HANDOVER_SOON_HORIZON_MS;
      }
    }
  }

  private sortMatches(matches: Match[], sort: SearchState["sort"]): void {
    const byId = (a: IndexedProperty, b: IndexedProperty) => a.id.localeCompare(b.id); // final deterministic tiebreak
    switch (sort) {
      case "price_asc":
        matches.sort((a, b) => priceAed(a.doc) - priceAed(b.doc) || byId(a.doc, b.doc));
        break;
      case "price_desc":
        matches.sort((a, b) => priceAed(b.doc) - priceAed(a.doc) || byId(a.doc, b.doc));
        break;
      case "newest":
        matches.sort((a, b) => (b.doc.publishedAt ?? 0) - (a.doc.publishedAt ?? 0) || byId(a.doc, b.doc));
        break;
      case "area_desc":
        matches.sort((a, b) => (b.doc.areaSqft ?? 0) - (a.doc.areaSqft ?? 0) || byId(a.doc, b.doc));
        break;
      case "price_per_sqft_asc": {
        // Listings without a recorded area sort last (unknown, not zero).
        const key = (d: IndexedProperty) => {
          const p = ppsfAed(d);
          return p === null ? Number.POSITIVE_INFINITY : p;
        };
        matches.sort((a, b) => key(a.doc) - key(b.doc) || byId(a.doc, b.doc));
        break;
      }
      case "yield_desc":
        // Modeled community yield desc; communities without the metric last.
        matches.sort(
          (a, b) =>
            (b.doc.communityYieldPct ?? Number.NEGATIVE_INFINITY) - (a.doc.communityYieldPct ?? Number.NEGATIVE_INFINITY) ||
            byId(a.doc, b.doc)
        );
        break;
      default: {
        // relevance: token score first, then featured/exclusive boost, then
        // recency — every comparator chained to the id tiebreak.
        matches.sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.doc.isFeatured) - Number(a.doc.isFeatured) ||
            Number(b.doc.isExclusive) - Number(a.doc.isExclusive) ||
            (b.doc.publishedAt ?? 0) - (a.doc.publishedAt ?? 0) ||
            byId(a.doc, b.doc)
        );
      }
    }
  }

  private buildFacets(matches: Match[]): FacetCounts {
    const communities = new Map<string, number>();
    const propertyTypes = new Map<string, number>();
    const developers = new Map<string, number>();
    const bedrooms = new Map<number, number>();
    const amenities = new Map<string, number>();
    const views = new Map<string, number>();
    const bucketCounts = new Array<number>(PRICE_BUCKETS.length).fill(0);

    for (const { doc } of matches) {
      communities.set(doc.communitySlug, (communities.get(doc.communitySlug) ?? 0) + 1);
      propertyTypes.set(doc.propertyType, (propertyTypes.get(doc.propertyType) ?? 0) + 1);
      if (doc.developerSlug) developers.set(doc.developerSlug, (developers.get(doc.developerSlug) ?? 0) + 1);
      bedrooms.set(doc.bedrooms, (bedrooms.get(doc.bedrooms) ?? 0) + 1);
      for (const a of doc.amenities) amenities.set(a, (amenities.get(a) ?? 0) + 1);
      if (doc.view) views.set(doc.view, (views.get(doc.view) ?? 0) + 1);

      const price = priceAed(doc);
      for (let i = 0; i < PRICE_BUCKETS.length; i++) {
        const b = PRICE_BUCKETS[i];
        if (price >= b.min && (b.max === null || price < b.max)) {
          bucketCounts[i]++;
          break;
        }
      }
    }

    return {
      communities,
      propertyTypes,
      developers,
      bedrooms,
      amenities,
      views,
      priceBuckets: PRICE_BUCKETS.map((b, i) => ({ key: b.key, min: b.min, max: b.max, count: bucketCounts[i] })),
    };
  }
}

/** Match a filter value list against a doc's id and/or slug (either form). */
function idOrSlugMatch(values: string[], id: string | null, slug: string | null): boolean {
  const wanted = new Set(values.map((v) => v.toLowerCase()));
  if (id && wanted.has(id.toLowerCase())) return true;
  if (slug && wanted.has(slug.toLowerCase())) return true;
  return false;
}

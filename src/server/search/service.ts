/**
 * Search service — builds/queries the search index from the canonical DB (F06:
 * indexes are rebuildable projections; DB is source of truth). Index mutations
 * flow from outbox events; full rebuild available for recovery.
 */
import { db, parseJson } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { LocalSearchProvider } from "./local-provider";
import type { AutocompleteItem, IndexedProperty, SearchProvider, SearchState } from "./types";
import type { ListingCardDTO, SearchResponse } from "@/lib/types";
import { cache } from "@/server/cache";
import { PUBLIC_AGENT_WHERE, PUBLIC_COMMUNITY_WHERE, publicListingWhere } from "@/server/domain/visibility";
import { searchResponseSchema } from "@/lib/contracts";
import { searchTokens } from "./normalize";
import { withSearchFallback } from "./resilience";
import { HttpError } from "@/server/auth";
import { validMapPoint } from "@/lib/map-state";
import {
  autocompletePostgres,
  postgresDocumentCount,
  replacePostgresDocuments,
  searchPostgres,
} from "./postgres-provider";

const provider: SearchProvider = new LocalSearchProvider();
let built = false;
let building: Promise<void> | null = null;

function usesPostgres(): boolean {
  return getConfig().SEARCH_PROVIDER === "postgres";
}

/** Cover URL resolution with in-memory media cache */
const mediaCache = new Map<string, { url: string; alt: string | null; width: number | null; height: number | null; kind: string }>();

async function loadMediaFor(properties: string[]): Promise<void> {
  if (!properties.length) return;
  const missing = properties.filter((id) => !mediaCache.has(id));
  if (!missing.length) return;
  const rows = await db.propertyMedia.findMany({
    where: { propertyId: { in: missing }, media: { isPrivate: false, kind: "IMAGE" } },
    orderBy: [{ sortOrder: "asc" }, { isCover: "desc" }],
    include: { media: true },
  });
  // first per property = cover
  for (const row of rows) {
    if (!mediaCache.has(row.propertyId)) {
      mediaCache.set(row.propertyId, {
        url: row.media.url,
        alt: row.media.altText,
        width: row.media.width,
        height: row.media.height,
        kind: row.media.kind,
      });
    }
  }
}

export async function assembleSearchDocuments(propertyId?: string, limit?: number): Promise<IndexedProperty[]> {
  mediaCache.clear();

  const listings = await db.listing.findMany({
    ...(limit ? { take: limit + 1, orderBy: { id: "asc" as const } } : {}),
    where: propertyId
      ? { AND: [publicListingWhere(), { property: { is: { id: propertyId } } }] }
      : publicListingWhere(),
    include: {
      property: {
        include: {
          community: true,
          project: { include: { developer: true } },
          developer: true,
          amenities: { include: { amenity: true } },
        },
      },
      agent: true,
    },
  });

  if (limit && listings.length > limit) throw new HttpError(503, "Property search exceeds the bounded fallback limit. Please retry after index recovery.", "SEARCH_FALLBACK_LIMIT");

  const propertyIds = listings.map((l) => l.propertyId);
  await loadMediaFor(propertyIds);

  // Payment plan down-payment percents per project (for payment-plan filters)
  const plans = await db.paymentPlan.findMany({
    where: { project: { properties: { some: { id: { in: propertyIds } } } } },
    include: { installments: true },
  });
  const projectDownPercent = new Map<string, number>();
  const projectPostHandover = new Map<string, boolean>();
  for (const plan of plans) {
    const early = plan.installments
      .filter((i) => (i.dueOffsetMonths ?? 0) <= 12)
      .reduce((sum, i) => sum + i.percent, 0);
    // keep the max across plans (conservative)
    const prev = projectDownPercent.get(plan.projectId) ?? 0;
    projectDownPercent.set(plan.projectId, Math.max(prev, Math.round(early)));
    if (plan.postHandover) projectPostHandover.set(plan.projectId, true);
  }

  // V2 (U04 §12.6): latest per-community modeled metrics — community average
  // asking AED/sqft (below-median smart filter) and modeled gross yield
  // (high-yield smart filter + yield sort + yieldMin filter).
  const communityIds = [...new Set(listings.map((l) => l.property.communityId))];
  const metricRows = await db.marketMetric.findMany({
    where: { communityId: { in: communityIds }, metricKey: { in: ["AVG_PRICE_PER_SQFT", "YIELD_PCT"] } },
    orderBy: { periodStart: "desc" },
  });
  const communityAvgPsqft = new Map<string, number>();
  const communityYieldPct = new Map<string, number>();
  for (const m of metricRows) {
    if (!m.communityId) continue;
    if (m.metricKey === "AVG_PRICE_PER_SQFT") {
      if (!communityAvgPsqft.has(m.communityId)) communityAvgPsqft.set(m.communityId, m.valueNumeric);
    } else if (m.metricKey === "YIELD_PCT") {
      if (!communityYieldPct.has(m.communityId)) communityYieldPct.set(m.communityId, m.valueNumeric);
    }
  }

  const documents: IndexedProperty[] = [];
  for (const l of listings) {
    const p = l.property;
    if (!validMapPoint(p.lat, p.lng)) continue;
    const publicAgent = l.agent?.active && l.agent.publicAdvisor ? l.agent : null;
    const cover = mediaCache.get(p.id) ?? null;
    const amenities = p.amenities.map((a) => a.amenity.key);
    const textParts = [
      p.title,
      p.community.name,
      p.project?.name,
      p.project?.developer.name,
      p.developer?.name,
      p.propertyType,
      p.view,
      p.furnishing,
      ...amenities,
    ].filter(Boolean) as string[];

    const doc: IndexedProperty = {
      id: l.id,
      propertyId: p.id,
      slug: p.slug,
      title: p.title,
      listingType: l.listingType,
      propertyType: p.propertyType,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaSqft: p.builtUpAreaSqft,
      priceMinor: l.priceMinor,
      currency: l.currency,
      priceQualifier: l.priceQualifier,
      rentFrequency: l.rentFrequency,
      availabilityStatus: l.availabilityStatus,
      offPlan: l.offPlan,
      isFeatured: l.isFeatured,
      isExclusive: l.isExclusive,
      furnished: p.furnishing === "FURNISHED",
      communityId: p.communityId,
      communityName: p.community.name,
      communitySlug: p.community.slug,
      projectId: p.projectId,
      projectName: p.project?.name ?? null,
      projectSlug: p.project?.slug ?? null,
      projectStatus: p.project?.status ?? null,
      developerId: p.developerId ?? p.project?.developerId ?? null,
      developerName: p.developer?.name ?? p.project?.developer.name ?? null,
      developerSlug: p.developer?.slug ?? p.project?.developer.slug ?? null,
      agentId: publicAgent?.id ?? null,
      agentSlug: publicAgent?.slug ?? null,
      amenities,
      lat: p.lat,
      lng: p.lng,
      publishedAt: l.publishedAt?.getTime() ?? null,
      handoverQuarter: p.handoverQuarter,
      view: p.view,
      coverUrl: cover?.url ?? null,
      coverAlt: cover?.alt ?? null,
      coverWidth: cover?.width ?? null,
      coverHeight: cover?.height ?? null,
      paymentPlanDownPercent: p.projectId ? projectDownPercent.get(p.projectId) ?? null : null,
      paymentPlanPostHandover: p.projectId ? projectPostHandover.get(p.projectId) ?? null : null,
      isDemoData: p.isDemoData,
      furnishing: p.furnishing ?? null,
      communityAreaType: p.community.areaType,
      communityAvgPsqft: communityAvgPsqft.get(p.communityId) ?? null,
      communityYieldPct: communityYieldPct.get(p.communityId) ?? null,
      tokens: new Set(searchTokens(`${textParts.join(" ")} ${cover?.alt ?? ""}`)),
    };
    documents.push(doc);
  }
  return documents;
}

async function buildIndex(): Promise<void> {
  const documents = await assembleSearchDocuments();
  if (usesPostgres()) {
    await replacePostgresDocuments(documents);
  } else {
    provider.clear();
    for (const document of documents) provider.upsert(document);
  }
  built = true;
}

export async function ensureIndex(): Promise<void> {
  if (built) return;
  if (!building) {
    building = (async () => {
      // A persisted projection survives application restarts. Rebuild only when
      // the table is empty; canonical mutations are handled by outbox events.
      if (usesPostgres() && (await postgresDocumentCount()) > 0) {
        built = true;
        return;
      }
      await buildIndex();
    })().finally(() => {
      building = null;
    });
  }
  await building;
}

/**
 * U21 fix: NL search chips carry community display names ("Dubai Marina")
 * while the index filters on slugs — resolve either form (slug or exact name,
 * case-insensitive) to slugs so sentence searches don't silently return 0
 * results. Unknown values pass through unchanged (search then reports them
 * honestly as no-match instead of a false total).
 */
export async function resolveCommunitySlugs(csv: string): Promise<string[]> {
  const wanted = csv.split(",").map((c) => c.trim()).filter(Boolean);
  if (!wanted.length) return [];
  const rows = await db.community.findMany({
    where: { ...PUBLIC_COMMUNITY_WHERE, OR: wanted.flatMap((w) => [{ slug: w }, { name: w }]) },
    select: { slug: true, name: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug.toLowerCase(), r.slug]));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.slug]));
  return wanted.map((w) => bySlug.get(w.toLowerCase()) ?? byName.get(w.toLowerCase()) ?? w);
}

export async function rebuildIndex(limit?: number): Promise<{ count: number }> {
  cache.invalidatePrefix("search:");
  if (usesPostgres()) {
    const documents = await assembleSearchDocuments(undefined, limit);
    const count = await replacePostgresDocuments(documents);
    built = true;
    return { count };
  }
  if (limit) {
    const documents = await assembleSearchDocuments(undefined, limit);
    provider.clear(); for (const document of documents) provider.upsert(document);
    built = true; return { count: documents.length };
  }
  built = false;
  await ensureIndex();
  return { count: provider.size() };
}

/** Outbox-driven single property reindex */
export async function reindexProperty(propertyId: string): Promise<void> {
  if (usesPostgres()) {
    const documents = await assembleSearchDocuments(propertyId);
    await replacePostgresDocuments(documents, propertyId);
    cache.invalidatePrefix("search:");
    built = true;
    return;
  }

  const listing = await db.listing.findFirst({
    where: { AND: [publicListingWhere(), { property: { is: { id: propertyId } } }] },
    include: {
      property: {
        include: { community: true, project: { include: { developer: true } }, developer: true, amenities: { include: { amenity: true } } },
      },
      agent: true,
    },
  });
  if (!listing) {
    (provider as LocalSearchProvider).removeByProperty(propertyId);
    cache.invalidatePrefix("search:");
    return;
  }
  await loadMediaFor([propertyId]);
  const p = listing.property;
  const publicAgent = listing.agent?.active && listing.agent.publicAdvisor ? listing.agent : null;
  const cover = mediaCache.get(propertyId) ?? null;

  // V2 (U04): join the same modeled community metrics the full index build uses.
  const [metrics, postHandoverPlans] = await Promise.all([
    db.marketMetric.findMany({
      where: { communityId: p.communityId, metricKey: { in: ["AVG_PRICE_PER_SQFT", "YIELD_PCT"] } },
      orderBy: { periodStart: "desc" },
    }),
    p.projectId
      ? db.paymentPlan.findMany({ where: { projectId: p.projectId, postHandover: true }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  let avgPsqft: number | null = null;
  let yieldPct: number | null = null;
  for (const m of metrics) {
    if (m.metricKey === "AVG_PRICE_PER_SQFT" && avgPsqft === null) avgPsqft = m.valueNumeric;
    if (m.metricKey === "YIELD_PCT" && yieldPct === null) yieldPct = m.valueNumeric;
  }

  provider.upsert({
    id: listing.id,
    propertyId: p.id,
    slug: p.slug,
    title: p.title,
    listingType: listing.listingType,
    propertyType: p.propertyType,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    areaSqft: p.builtUpAreaSqft,
    priceMinor: listing.priceMinor,
    currency: listing.currency,
    priceQualifier: listing.priceQualifier,
    rentFrequency: listing.rentFrequency,
    availabilityStatus: listing.availabilityStatus,
    offPlan: listing.offPlan,
    isFeatured: listing.isFeatured,
    isExclusive: listing.isExclusive,
    furnished: p.furnishing === "FURNISHED",
    communityId: p.communityId,
    communityName: p.community.name,
    communitySlug: p.community.slug,
    projectId: p.projectId,
    projectName: p.project?.name ?? null,
    projectSlug: p.project?.slug ?? null,
    projectStatus: p.project?.status ?? null,
    developerId: p.developerId ?? p.project?.developerId ?? null,
    developerName: p.developer?.name ?? p.project?.developer.name ?? null,
    developerSlug: p.developer?.slug ?? p.project?.developer.slug ?? null,
    agentId: publicAgent?.id ?? null,
    agentSlug: publicAgent?.slug ?? null,
    amenities: p.amenities.map((a) => a.amenity.key),
    lat: p.lat,
    lng: p.lng,
    publishedAt: listing.publishedAt?.getTime() ?? null,
    handoverQuarter: p.handoverQuarter,
    view: p.view,
    coverUrl: cover?.url ?? null,
    coverAlt: cover?.alt ?? null,
    coverWidth: cover?.width ?? null,
    coverHeight: cover?.height ?? null,
    paymentPlanDownPercent: null,
    paymentPlanPostHandover: p.projectId ? postHandoverPlans.length > 0 : null,
    isDemoData: p.isDemoData,
    furnishing: p.furnishing ?? null,
    communityAreaType: p.community.areaType,
    communityAvgPsqft: avgPsqft,
    communityYieldPct: yieldPct,
    tokens: new Set(
      searchTokens(
        [p.title, p.community.name, p.project?.name, p.developer?.name, p.propertyType, p.view, p.furnishing]
          .filter(Boolean)
          .join(" ")
      )
    ),
  });
  cache.invalidatePrefix("search:");
}

/* -------------------------- Query API ------------------------------------ */

function docToCard(doc: IndexedProperty): ListingCardDTO {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    propertyType: doc.propertyType,
    listingType: doc.listingType as ListingCardDTO["listingType"],
    bedrooms: doc.bedrooms,
    bathrooms: doc.bathrooms,
    areaSqft: doc.areaSqft,
    price: { minor: doc.priceMinor.toString(), currency: doc.currency, qualifier: doc.priceQualifier, rentFrequency: doc.rentFrequency },
    availabilityStatus: doc.availabilityStatus,
    offPlan: doc.offPlan,
    isFeatured: doc.isFeatured,
    isExclusive: doc.isExclusive,
    community: { id: doc.communityId, name: doc.communityName, slug: doc.communitySlug },
    project: doc.projectId ? { id: doc.projectId, name: doc.projectName ?? "", slug: doc.projectSlug ?? "" } : null,
    developer: doc.developerId ? { id: doc.developerId, name: doc.developerName ?? "", slug: doc.developerSlug ?? "" } : null,
    agent: doc.agentId ? { id: doc.agentId, name: "", slug: doc.agentSlug ?? "" } : null,
    cover: doc.coverUrl ? { id: "", url: doc.coverUrl, altText: doc.coverAlt, width: doc.coverWidth, height: doc.coverHeight } : null,
    lat: doc.lat,
    lng: doc.lng,
    handoverQuarter: doc.handoverQuarter,
    view: doc.view,
    furnishing: doc.furnishing,
    isDemoData: doc.isDemoData,
  };
}

export async function publicMapListing(slug: string): Promise<ListingCardDTO | null> {
  const listing = await db.listing.findFirst({ where: { AND: [publicListingWhere(), { property: { slug } }] }, select: { id: true, propertyId: true } });
  if (!listing) return null;
  const documents = await assembleSearchDocuments(listing.propertyId, 20);
  const doc = documents.find((d) => d.id === listing.id);
  if (!doc) return null;
  const cards = [docToCard(doc)]; await hydrateAgentNames(cards);
  return cards[0];
}

/** ids → DTOs joined with agent names (agent name lives in DB, not index) */
async function hydrateAgentNames(cards: ListingCardDTO[]): Promise<void> {
  const agentIds = [...new Set(cards.map((c) => c.agent?.id).filter(Boolean))] as string[];
  if (!agentIds.length) return;
  const agents = await db.agent.findMany({ where: { ...PUBLIC_AGENT_WHERE, id: { in: agentIds } }, select: { id: true, name: true, slug: true, phoneE164: true } });
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const c of cards) {
    if (c.agent) {
      const a = byId.get(c.agent.id);
      if (a) c.agent = { id: a.id, name: a.name, slug: a.slug, phone: a.phoneE164 };
    }
  }
}

export async function search(state: SearchState): Promise<SearchResponse> {
  const key = `search:${usesPostgres() ? "postgres" : "local"}:${JSON.stringify(state)}`;
  const cached = cache.get<SearchResponse>(key);
  if (cached) return cached;

  const execution = await withSearchFallback(async () => {
    await ensureIndex();
    if (usesPostgres()) return await searchPostgres(state);
    const result = provider.search(state);
    return { result, documents: (provider as LocalSearchProvider).getDocs(result.ids) };
  }, async () => {
    const fallback = new LocalSearchProvider();
    for (const document of await assembleSearchDocuments(undefined, 1000)) fallback.upsert(document);
    const result = fallback.search(state);
    return { result, documents: fallback.getDocs(result.ids) };
  });
  const result = execution.value.result;
  const all = execution.value.documents;
  const cards = all.map(docToCard);
  await hydrateAgentNames(cards);

  const communityNames = await db.community.findMany({
    where: { slug: { in: [...result.facets.communities.keys()] } },
    select: { id: true, name: true, slug: true },
  });
  const developerNames = await db.developer.findMany({
    where: { slug: { in: [...result.facets.developers.keys()] } },
    select: { id: true, name: true, slug: true },
  });
  const amenityNames = await db.amenity.findMany({
    where: { key: { in: [...result.facets.amenities.keys()] } },
    select: { key: true, name: true },
  });

  const response: SearchResponse & {
    /** V2 §12.3 (U04) — view facet counts, additive. */
    facets: SearchResponse["facets"] & { views: { key: string; count: number }[] };
  } = {
    results: cards,
    total: result.total,
    page: state.page,
    pageSize: state.pageSize,
    tookMs: result.tookMs,
    degraded: execution.degraded,
    facets: {
      total: result.total,
      communities: communityNames.map((c) => ({ ...c, count: result.facets.communities.get(c.slug) ?? 0 })),
      propertyTypes: [...result.facets.propertyTypes.entries()].map(([key, count]) => ({ key, count })),
      priceBuckets: result.facets.priceBuckets.map((b) => ({
        key: b.key,
        minMinor: String(b.min * 100),
        maxMinor: b.max === null ? "" : String(b.max * 100),
        count: b.count,
      })),
      bedroomCounts: [...result.facets.bedrooms.entries()].map(([key, count]) => ({ key, count })),
      amenities: amenityNames.map((a) => ({ key: a.key, name: a.name, count: result.facets.amenities.get(a.key) ?? 0 })),
      developers: developerNames.map((d) => ({ id: d.id, name: d.name, count: result.facets.developers.get(d.slug) ?? 0 })),
      views: [...result.facets.views.entries()].map(([key, count]) => ({ key, count })),
    },
  };
  const contracted = searchResponseSchema.parse(response);
  if (!execution.degraded) cache.set(key, contracted, 30_000);
  return contracted;
}

export async function autocomplete(prefix: string, limit = 8): Promise<AutocompleteItem[]> {
  const execution = await withSearchFallback(async () => {
    await ensureIndex();
    return usesPostgres() ? autocompletePostgres(prefix, limit) : provider.autocomplete(prefix, limit);
  }, async () => {
    const fallback = new LocalSearchProvider();
    for (const document of await assembleSearchDocuments(undefined, 1000)) fallback.upsert(document);
    return fallback.autocomplete(prefix, limit);
  });
  return execution.value;
}

export function communityListFromIndex() {
  return (provider as LocalSearchProvider).communityList();
}

export async function indexStatus() {
  /* U24: probe the actual provider rather than trusting the module-level flag —
   * dev-mode module duplication (instrumentation vs route instances) can leave
   * this instance's provider unbuilt even while another instance serves traffic.
   * Self-heal: build on demand if empty, then report the authoritative state. */
  if (usesPostgres()) {
    try {
      await ensureIndex();
      return { provider: "postgres", size: await postgresDocumentCount(), built };
    } catch {
      return { provider: "postgres", size: 0, built: false };
    }
  }

  let liveSize = 0;
  try {
    liveSize = provider.size();
  } catch {
    liveSize = 0;
  }
  if (liveSize === 0 && !built) {
    try {
      await ensureIndex();
      liveSize = provider.size();
    } catch {
      /* index build failure is reported as-is below */
    }
  }
  const healthy = built || liveSize > 0;
  return { provider: getConfig().SEARCH_PROVIDER, size: liveSize, built: healthy };
}

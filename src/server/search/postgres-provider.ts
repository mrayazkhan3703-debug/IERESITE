import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AutocompleteItem, FacetCounts, IndexedProperty, SearchResult, SearchState } from "./types";
import { normalizeSearchText } from "./normalize";

const PRICE_BUCKETS = [
  { key: "0-1000000", min: 0, max: 1_000_000 },
  { key: "1000000-2000000", min: 1_000_000, max: 2_000_000 },
  { key: "2000000-5000000", min: 2_000_000, max: 5_000_000 },
  { key: "5000000-10000000", min: 5_000_000, max: 10_000_000 },
  { key: "10000000-plus", min: 10_000_000, max: null },
] as const;

type SearchDocumentRow = {
  listingId: string;
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
  furnishing: string | null;
  communityId: string;
  communityName: string;
  communitySlug: string;
  communityAreaType: string;
  communityAvgPsqft: number | null;
  communityYieldPct: number | null;
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
  publishedAt: Date | null;
  handoverQuarter: string | null;
  view: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  paymentPlanDownPercent: number | null;
  paymentPlanPostHandover: boolean | null;
  isDemoData: boolean;
};

export type MapSearchCluster = {
  lat: number;
  lng: number;
  count: number;
  listingId: string | null;
  slug: string | null;
  title: string | null;
  priceMinor: string | null;
  currency: string | null;
};

// Never SELECT * here: generated tsvector/geography columns are intentionally
// Unsupported in Prisma and its raw-query decoder cannot deserialize them.
const ROW_COLUMNS = Prisma.sql`
  "listingId", "propertyId", "slug", "title", "listingType", "propertyType",
  "bedrooms", "bathrooms", "areaSqft", "priceMinor", "currency",
  "priceQualifier", "rentFrequency", "availabilityStatus", "offPlan",
  "isFeatured", "isExclusive", "furnished", "furnishing", "communityId",
  "communityName", "communitySlug", "communityAreaType", "communityAvgPsqft",
  "communityYieldPct", "projectId", "projectName", "projectSlug", "projectStatus",
  "developerId", "developerName", "developerSlug", "agentId", "agentSlug",
  "amenities", "lat", "lng", "publishedAt", "handoverQuarter", "view",
  "coverUrl", "coverAlt", "coverWidth", "coverHeight", "paymentPlanDownPercent",
  "paymentPlanPostHandover", "isDemoData"
`;

function documentText(doc: IndexedProperty): string {
  return normalizeSearchText(
    [
      doc.title,
      doc.communityName,
      doc.projectName,
      doc.developerName,
      doc.propertyType,
      doc.view,
      doc.furnishing,
      ...doc.amenities,
      doc.coverAlt,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function persistenceData(doc: IndexedProperty): Prisma.SearchDocumentCreateManyInput {
  return {
    listingId: doc.id,
    propertyId: doc.propertyId,
    slug: doc.slug,
    title: doc.title,
    normalizedText: documentText(doc),
    listingType: doc.listingType,
    propertyType: doc.propertyType,
    bedrooms: doc.bedrooms,
    bathrooms: doc.bathrooms,
    areaSqft: doc.areaSqft,
    priceMinor: doc.priceMinor,
    currency: doc.currency,
    priceQualifier: doc.priceQualifier,
    rentFrequency: doc.rentFrequency,
    availabilityStatus: doc.availabilityStatus,
    offPlan: doc.offPlan,
    isFeatured: doc.isFeatured,
    isExclusive: doc.isExclusive,
    furnished: doc.furnished,
    furnishing: doc.furnishing,
    communityId: doc.communityId,
    communityName: doc.communityName,
    communitySlug: doc.communitySlug,
    communityAreaType: doc.communityAreaType,
    communityAvgPsqft: doc.communityAvgPsqft,
    communityYieldPct: doc.communityYieldPct,
    projectId: doc.projectId,
    projectName: doc.projectName,
    projectSlug: doc.projectSlug,
    projectStatus: doc.projectStatus,
    developerId: doc.developerId,
    developerName: doc.developerName,
    developerSlug: doc.developerSlug,
    agentId: doc.agentId,
    agentSlug: doc.agentSlug,
    amenities: doc.amenities,
    lat: doc.lat,
    lng: doc.lng,
    publishedAt: doc.publishedAt === null ? null : new Date(doc.publishedAt),
    handoverQuarter: doc.handoverQuarter,
    view: doc.view,
    coverUrl: doc.coverUrl,
    coverAlt: doc.coverAlt,
    coverWidth: doc.coverWidth,
    coverHeight: doc.coverHeight,
    paymentPlanDownPercent: doc.paymentPlanDownPercent,
    paymentPlanPostHandover: doc.paymentPlanPostHandover,
    isDemoData: doc.isDemoData,
  };
}

export async function replacePostgresDocuments(documents: IndexedProperty[], propertyId?: string): Promise<number> {
  await db.$transaction(async (tx) => {
    // Serialize startup/admin/worker rebuilds so delete+insert replacement
    // cannot race another process and create duplicate primary-key failures.
    await tx.$executeRaw`LOCK TABLE "SearchDocument" IN EXCLUSIVE MODE`;
    if (propertyId) await tx.searchDocument.deleteMany({ where: { propertyId } });
    else await tx.searchDocument.deleteMany();
    if (documents.length) await tx.searchDocument.createMany({ data: documents.map(persistenceData) });
  });
  return documents.length;
}

export function postgresDocumentCount(): Promise<number> {
  return db.searchDocument.count();
}

function inList(column: string, values: string[]): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`;
}

function quarterIndex(raw: string): number | null {
  const quarter = /^q([1-4])[\s-]+(\d{4})$/i.exec(raw.trim());
  if (quarter) return Number(quarter[2]) * 4 + Number(quarter[1]) - 1;
  if (/^\d{4}$/.test(raw.trim())) return Number(raw.trim()) * 4 + 3;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3) : null;
}

const PUBLIC_DOCUMENT_CONDITION = Prisma.sql`EXISTS (
  SELECT 1 FROM "Listing" current_listing JOIN "Property" current_property ON current_property.id = current_listing."propertyId"
  WHERE current_listing.id = "SearchDocument"."listingId"
    AND current_property."publicationStatus" = 'PUBLISHED' AND current_property."deletedAt" IS NULL
    AND current_listing."publishedAt" <= CURRENT_TIMESTAMP
    AND (current_listing."expiresAt" IS NULL OR current_listing."expiresAt" > CURRENT_TIMESTAMP)
    AND current_listing."availabilityStatus" <> 'WITHDRAWN'
)`;
function whereFor(state: SearchState): { where: Prisma.Sql; score: Prisma.Sql } {
  const conditions: Prisma.Sql[] = [PUBLIC_DOCUMENT_CONDITION, Prisma.sql`"listingType" = ${state.listingType}`];
  const normalizedQuery = normalizeSearchText(state.q ?? "");
  const score = normalizedQuery
    ? Prisma.sql`(
        ts_rank_cd("search_vector", websearch_to_tsquery('simple', ${normalizedQuery})) * 0.8 +
        word_similarity(${normalizedQuery}, "normalizedText") * 0.2
      )`
    : Prisma.sql`0.0`;
  if (normalizedQuery) {
    conditions.push(
      Prisma.sql`("search_vector" @@ websearch_to_tsquery('simple', ${normalizedQuery}) OR "normalizedText" %> ${normalizedQuery})`
    );
  }
  if (state.propertyTypes?.length) conditions.push(inList(`UPPER("propertyType")`, state.propertyTypes.map((v) => v.toUpperCase())));
  if (state.communities?.length) conditions.push(inList(`"communitySlug"`, state.communities));
  if (state.developers?.length) {
    conditions.push(
      Prisma.sql`("developerId" IN (${Prisma.join(state.developers)}) OR "developerSlug" IN (${Prisma.join(state.developers)}))`
    );
  }
  if (state.projects?.length) {
    conditions.push(Prisma.sql`("projectId" IN (${Prisma.join(state.projects)}) OR "projectSlug" IN (${Prisma.join(state.projects)}))`);
  }
  if (state.agents?.length) {
    conditions.push(Prisma.sql`("agentId" IN (${Prisma.join(state.agents)}) OR "agentSlug" IN (${Prisma.join(state.agents)}))`);
  }
  if (state.priceMin !== undefined) conditions.push(Prisma.sql`"priceMinor" >= ${BigInt(state.priceMin) * 100n}`);
  if (state.priceMax !== undefined) conditions.push(Prisma.sql`"priceMinor" <= ${BigInt(state.priceMax) * 100n}`);
  if (state.bedroomsMin !== undefined) conditions.push(Prisma.sql`"bedrooms" >= ${state.bedroomsMin}`);
  if (state.bedroomsMax !== undefined) conditions.push(Prisma.sql`"bedrooms" <= ${state.bedroomsMax}`);
  if (state.bathroomsMin !== undefined) conditions.push(Prisma.sql`"bathrooms" >= ${state.bathroomsMin}`);
  if (state.areaMin !== undefined) conditions.push(Prisma.sql`"areaSqft" >= ${state.areaMin}`);
  if (state.areaMax !== undefined) conditions.push(Prisma.sql`"areaSqft" <= ${state.areaMax}`);
  if (state.ppsfMin !== undefined) {
    conditions.push(Prisma.sql`"areaSqft" > 0 AND ("priceMinor"::numeric / 100.0 / "areaSqft") >= ${state.ppsfMin}`);
  }
  if (state.ppsfMax !== undefined) {
    conditions.push(Prisma.sql`"areaSqft" > 0 AND ("priceMinor"::numeric / 100.0 / "areaSqft") <= ${state.ppsfMax}`);
  }
  if (state.amenities?.length) conditions.push(Prisma.sql`"amenities" && ARRAY[${Prisma.join(state.amenities)}]::text[]`);
  if (state.offPlan !== undefined) conditions.push(Prisma.sql`"offPlan" = ${state.offPlan}`);
  if (state.furnished !== undefined) conditions.push(Prisma.sql`"furnished" = ${state.furnished}`);
  if (state.exclusive !== undefined) conditions.push(Prisma.sql`"isExclusive" = ${state.exclusive}`);
  if (state.featured !== undefined) conditions.push(Prisma.sql`"isFeatured" = ${state.featured}`);
  if (state.availability?.length) conditions.push(inList(`UPPER("availabilityStatus")`, state.availability.map((v) => v.toUpperCase())));
  if (state.projectStatus?.length) conditions.push(inList(`UPPER("projectStatus")`, state.projectStatus.map((v) => v.toUpperCase())));
  if (state.paymentPlanMaxDown !== undefined) conditions.push(Prisma.sql`"paymentPlanDownPercent" <= ${state.paymentPlanMaxDown}`);
  if (state.views?.length) conditions.push(inList(`UPPER("view")`, state.views.map((v) => v.toUpperCase())));
  if (state.furnishings?.length) conditions.push(inList(`UPPER("furnishing")`, state.furnishings.map((v) => v.toUpperCase())));
  if (state.yieldMin !== undefined) conditions.push(Prisma.sql`"communityYieldPct" >= ${state.yieldMin}`);
  if (state.handoverFromYear !== undefined) {
    conditions.push(Prisma.sql`"handoverQuarter" ~* '^Q[1-4][ -]+[0-9]{4}$' AND substring("handoverQuarter" from '[0-9]{4}')::int >= ${state.handoverFromYear}`);
  }
  if (state.handoverToYear !== undefined) {
    conditions.push(Prisma.sql`"handoverQuarter" ~* '^Q[1-4][ -]+[0-9]{4}$' AND substring("handoverQuarter" from '[0-9]{4}')::int <= ${state.handoverToYear}`);
  }
  if (state.handoverBy) {
    const bound = quarterIndex(state.handoverBy);
    if (bound === null) conditions.push(Prisma.sql`FALSE`);
    else {
      conditions.push(
        Prisma.sql`"handoverQuarter" ~* '^Q[1-4][ -]+[0-9]{4}$' AND
          (substring("handoverQuarter" from '[0-9]{4}')::int * 4 + substring("handoverQuarter" from '(?i)^Q([1-4])')::int - 1) <= ${bound}`
      );
    }
  }
  if (state.postHandoverPlan !== undefined) conditions.push(Prisma.sql`"paymentPlanPostHandover" = ${state.postHandoverPlan}`);
  for (const smart of state.smart ?? []) {
    if (smart === "below_median") {
      conditions.push(Prisma.sql`"areaSqft" > 0 AND "communityAvgPsqft" IS NOT NULL AND ("priceMinor"::numeric / 100.0 / "areaSqft") < "communityAvgPsqft"`);
    } else if (smart === "waterfront") {
      conditions.push(Prisma.sql`("communityAreaType" IN ('WATERFRONT','ISLAND') OR lower("communityName") ~ '(waterfront|marina|beach|palm|island|sea|bay|crescent|quay|lagoon)')`);
    } else if (smart === "high_yield") {
      conditions.push(Prisma.sql`"communityYieldPct" >= 6`);
    } else if (smart === "handover_soon") {
      conditions.push(Prisma.sql`"offPlan" = TRUE AND "handoverQuarter" ~* '^Q[1-4][ -]+[0-9]{4}$' AND substring("handoverQuarter" from '[0-9]{4}')::int BETWEEN EXTRACT(YEAR FROM CURRENT_DATE)::int AND EXTRACT(YEAR FROM CURRENT_DATE + INTERVAL '1 year')::int`);
    }
  }
  if (state.bbox) {
    const [west, south, east, north] = state.bbox;
    conditions.push(
      Prisma.sql`"geo" && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography AND ST_Intersects("geo", ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)`
    );
  }
  if (state.radiusKm !== undefined && state.centerLat !== undefined && state.centerLng !== undefined) {
    conditions.push(
      Prisma.sql`ST_DWithin("geo", ST_SetSRID(ST_MakePoint(${state.centerLng}, ${state.centerLat}), 4326)::geography, ${state.radiusKm * 1000})`
    );
  }
  if (state.polygon?.length) {
    const ring = [...state.polygon];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    const geoJson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
    conditions.push(
      Prisma.sql`ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 4326), "geo"::geometry)`
    );
  }
  return { where: Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`, score };
}

function orderFor(state: SearchState, score: Prisma.Sql): Prisma.Sql {
  switch (state.sort) {
    case "price_asc": return Prisma.sql`ORDER BY "priceMinor" ASC, "listingId" ASC`;
    case "price_desc": return Prisma.sql`ORDER BY "priceMinor" DESC, "listingId" ASC`;
    case "newest": return Prisma.sql`ORDER BY "publishedAt" DESC NULLS LAST, "listingId" ASC`;
    case "area_desc": return Prisma.sql`ORDER BY "areaSqft" DESC NULLS LAST, "listingId" ASC`;
    case "price_per_sqft_asc": return Prisma.sql`ORDER BY ("priceMinor"::numeric / 100.0 / NULLIF("areaSqft", 0)) ASC NULLS LAST, "listingId" ASC`;
    case "yield_desc": return Prisma.sql`ORDER BY "communityYieldPct" DESC NULLS LAST, "listingId" ASC`;
    default:
      // PostgreSQL treats a bare numeric ORDER BY expression as a positional
      // column reference, so `ORDER BY 0.0` is invalid for an empty query.
      return normalizeSearchText(state.q ?? "")
        ? Prisma.sql`ORDER BY ${score} DESC, "isFeatured" DESC, "isExclusive" DESC, "publishedAt" DESC NULLS LAST, "listingId" ASC`
        : Prisma.sql`ORDER BY "isFeatured" DESC, "isExclusive" DESC, "publishedAt" DESC NULLS LAST, "listingId" ASC`;
  }
}

function rowToDocument(row: SearchDocumentRow): IndexedProperty {
  return {
    id: row.listingId,
    propertyId: row.propertyId,
    slug: row.slug,
    title: row.title,
    listingType: row.listingType,
    propertyType: row.propertyType,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    areaSqft: row.areaSqft,
    priceMinor: row.priceMinor,
    currency: row.currency,
    priceQualifier: row.priceQualifier,
    rentFrequency: row.rentFrequency,
    availabilityStatus: row.availabilityStatus,
    offPlan: row.offPlan,
    isFeatured: row.isFeatured,
    isExclusive: row.isExclusive,
    furnished: row.furnished,
    furnishing: row.furnishing,
    communityId: row.communityId,
    communityName: row.communityName,
    communitySlug: row.communitySlug,
    communityAreaType: row.communityAreaType,
    communityAvgPsqft: row.communityAvgPsqft,
    communityYieldPct: row.communityYieldPct,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug,
    projectStatus: row.projectStatus,
    developerId: row.developerId,
    developerName: row.developerName,
    developerSlug: row.developerSlug,
    agentId: row.agentId,
    agentSlug: row.agentSlug,
    amenities: row.amenities,
    lat: row.lat,
    lng: row.lng,
    publishedAt: row.publishedAt?.getTime() ?? null,
    handoverQuarter: row.handoverQuarter,
    view: row.view,
    coverUrl: row.coverUrl,
    coverAlt: row.coverAlt,
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
    paymentPlanDownPercent: row.paymentPlanDownPercent,
    paymentPlanPostHandover: row.paymentPlanPostHandover,
    isDemoData: row.isDemoData,
    tokens: new Set(),
  };
}

function facetsFor(rows: SearchDocumentRow[]): FacetCounts {
  const communities = new Map<string, number>();
  const propertyTypes = new Map<string, number>();
  const developers = new Map<string, number>();
  const bedrooms = new Map<number, number>();
  const amenities = new Map<string, number>();
  const views = new Map<string, number>();
  const bucketCounts = PRICE_BUCKETS.map(() => 0);
  for (const row of rows) {
    communities.set(row.communitySlug, (communities.get(row.communitySlug) ?? 0) + 1);
    propertyTypes.set(row.propertyType, (propertyTypes.get(row.propertyType) ?? 0) + 1);
    if (row.developerSlug) developers.set(row.developerSlug, (developers.get(row.developerSlug) ?? 0) + 1);
    bedrooms.set(row.bedrooms, (bedrooms.get(row.bedrooms) ?? 0) + 1);
    for (const amenity of row.amenities) amenities.set(amenity, (amenities.get(amenity) ?? 0) + 1);
    if (row.view) views.set(row.view, (views.get(row.view) ?? 0) + 1);
    const price = Number(row.priceMinor) / 100;
    const index = PRICE_BUCKETS.findIndex((bucket) => price >= bucket.min && (bucket.max === null || price < bucket.max));
    if (index >= 0) bucketCounts[index]++;
  }
  return {
    communities,
    propertyTypes,
    developers,
    bedrooms,
    amenities,
    views,
    priceBuckets: PRICE_BUCKETS.map((bucket, index) => ({ ...bucket, count: bucketCounts[index] })),
  };
}

export async function searchPostgres(state: SearchState): Promise<{ result: SearchResult; documents: IndexedProperty[] }> {
  const startedAt = performance.now();
  const { where, score } = whereFor(state);
  const order = orderFor(state, score);
  const offset = (state.page - 1) * state.pageSize;
  const [pageRows, facetRows] = await Promise.all([
    db.$queryRaw<SearchDocumentRow[]>(Prisma.sql`
      SELECT ${ROW_COLUMNS} FROM "SearchDocument" ${where} ${order} LIMIT ${state.pageSize} OFFSET ${offset}
    `),
    db.$queryRaw<SearchDocumentRow[]>(Prisma.sql`SELECT ${ROW_COLUMNS} FROM "SearchDocument" ${where}`),
  ]);
  return {
    documents: pageRows.map(rowToDocument),
    result: {
      ids: pageRows.map((row) => row.listingId),
      total: facetRows.length,
      facets: facetsFor(facetRows),
      tookMs: Math.max(0, Math.round(performance.now() - startedAt)),
    },
  };
}

export async function autocompletePostgres(prefix: string, limit = 8): Promise<AutocompleteItem[]> {
  const normalized = normalizeSearchText(prefix);
  if (!normalized) return [];
  const rows = await db.$queryRaw<SearchDocumentRow[]>(Prisma.sql`
    SELECT ${ROW_COLUMNS} FROM "SearchDocument"
    WHERE ${PUBLIC_DOCUMENT_CONDITION} AND ("normalizedText" ILIKE ${`%${normalized}%`} OR "normalizedText" %> ${normalized})
    ORDER BY word_similarity(${normalized}, "normalizedText") DESC, "publishedAt" DESC NULLS LAST
    LIMIT 100
  `);
  const communities = new Map<string, { name: string; count: number }>();
  const projects = new Map<string, { name: string; count: number }>();
  const developers = new Map<string, { name: string; count: number }>();
  const items: AutocompleteItem[] = [];
  for (const row of rows) {
    const community = communities.get(row.communitySlug);
    communities.set(row.communitySlug, { name: row.communityName, count: (community?.count ?? 0) + 1 });
    if (row.projectSlug && row.projectName) {
      const project = projects.get(row.projectSlug);
      projects.set(row.projectSlug, { name: row.projectName, count: (project?.count ?? 0) + 1 });
    }
    if (row.developerSlug && row.developerName) {
      const developer = developers.get(row.developerSlug);
      developers.set(row.developerSlug, { name: row.developerName, count: (developer?.count ?? 0) + 1 });
    }
    items.push({ kind: "property", label: row.title, sublabel: row.communityName, slug: row.slug });
  }
  for (const [slug, item] of communities) items.push({ kind: "community", label: item.name, sublabel: "Community", slug, count: item.count });
  for (const [slug, item] of projects) items.push({ kind: "project", label: item.name, sublabel: "Project", slug, count: item.count });
  for (const [slug, item] of developers) items.push({ kind: "developer", label: item.name, sublabel: "Developer", slug, count: item.count });
  items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  return items.slice(0, Math.max(1, limit));
}

type MapClusterRow = {
  lat: number;
  lng: number;
  count: number;
  listingId: string | null;
  slug: string | null;
  title: string | null;
  priceMinor: bigint | null;
  currency: string | null;
};

/** Server-side, zoom-aware aggregation over every filtered match. */
export async function mapClustersPostgres(
  state: SearchState,
  zoom: number
): Promise<{ clusters: MapSearchCluster[]; total: number }> {
  const { where } = whereFor(state);
  const boundedZoom = Math.min(19, Math.max(3, zoom));
  const cellSize = Math.min(0.3, Math.max(0.003, 0.3 / Math.pow(2, Math.max(0, boundedZoom - 8))));
  const rows = await db.$queryRaw<MapClusterRow[]>(Prisma.sql`
    SELECT
      AVG("lat")::double precision AS "lat",
      AVG("lng")::double precision AS "lng",
      COUNT(*)::int AS "count",
      CASE WHEN COUNT(*) = 1 THEN MIN("listingId") END AS "listingId",
      CASE WHEN COUNT(*) = 1 THEN MIN("slug") END AS "slug",
      CASE WHEN COUNT(*) = 1 THEN MIN("title") END AS "title",
      CASE WHEN COUNT(*) = 1 THEN MIN("priceMinor") END AS "priceMinor",
      CASE WHEN COUNT(*) = 1 THEN MIN("currency") END AS "currency"
    FROM "SearchDocument"
    ${where}
    GROUP BY FLOOR("lng" / ${cellSize}), FLOOR("lat" / ${cellSize})
    ORDER BY COUNT(*) DESC, AVG("lat"), AVG("lng")
  `);
  return {
    clusters: rows.map((row) => ({
      ...row,
      priceMinor: row.priceMinor?.toString() ?? null,
    })),
    total: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

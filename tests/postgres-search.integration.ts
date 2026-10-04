import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { cache } from "@/server/cache";
import { autocomplete, rebuildIndex, reindexProperty, search } from "@/server/search/service";
import { searchStateSchema } from "@/server/search/types";
import { mapClustersPostgres } from "@/server/search/postgres-provider";
import { toolByName } from "@/server/ai/tools";

const baseUrl = process.env.TEST_BASE_URL ?? "http://host.docker.internal:3000";
const prefix = "pg-search-contract";
const ids = {
  community: `${prefix}-community`,
  developer: `${prefix}-developer`,
  amenity: `${prefix}-amenity`,
  nearProperty: `${prefix}-property-near`,
  arabicProperty: `${prefix}-property-arabic`,
  outsideProperty: `${prefix}-property-outside`,
  draftProperty: `${prefix}-property-draft`,
};

const queries = ["marina residnce", "فيلا الامارات الزمردية"];

async function cleanup() {
  await db.searchDocument.deleteMany({ where: { propertyId: { startsWith: prefix } } });
  await db.searchQuery.deleteMany({ where: { queryText: { in: queries } } });
  await db.property.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.amenity.deleteMany({ where: { id: ids.amenity } });
  await db.community.deleteMany({ where: { id: ids.community } });
  await db.developer.deleteMany({ where: { id: ids.developer } });
}

beforeAll(async () => {
  await cleanup();
  const publishedAt = new Date(Date.now() - 60_000);
  await db.developer.create({
    data: { id: ids.developer, name: "Zaffre Test Developer", slug: `${prefix}-developer` },
  });
  await db.community.create({
    data: {
      id: ids.community,
      name: "مجتمع الاختبار الزمردي",
      slug: `${prefix}-community`,
      areaType: "WATERFRONT",
      lat: 25.08,
      lng: 55.14,
      publicationStatus: "PUBLISHED",
    },
  });
  await db.amenity.create({
    data: { id: ids.amenity, key: `${prefix}-POOL`, name: "Contract Pool" },
  });

  const properties = [
    {
      id: ids.nearProperty,
      slug: `${prefix}-zaffre-residence`,
      title: "Zaffre Marina Residence",
      propertyType: "APARTMENT",
      bedrooms: 2,
      bathrooms: 2,
      builtUpAreaSqft: 1_200,
      lat: 25.08,
      lng: 55.14,
      publicationStatus: "PUBLISHED",
      priceMinor: 250_000_000n,
    },
    {
      id: ids.arabicProperty,
      slug: `${prefix}-arabic-villa`,
      title: "فِيلَا الإِمَارَات الزُّمُرُّدِيَّة",
      propertyType: "VILLA",
      bedrooms: 4,
      bathrooms: 5,
      builtUpAreaSqft: 4_000,
      lat: 25.085,
      lng: 55.145,
      publicationStatus: "PUBLISHED",
      priceMinor: 900_000_000n,
    },
    {
      id: ids.outsideProperty,
      slug: `${prefix}-outside-home`,
      title: "Zaffre Desert Garden Home",
      propertyType: "TOWNHOUSE",
      bedrooms: 3,
      bathrooms: 3,
      builtUpAreaSqft: 2_200,
      lat: 25.5,
      lng: 55.6,
      publicationStatus: "PUBLISHED",
      priceMinor: 400_000_000n,
    },
    {
      id: ids.draftProperty,
      slug: `${prefix}-draft`,
      title: "Zaffre Hidden Draft",
      propertyType: "APARTMENT",
      bedrooms: 1,
      bathrooms: 1,
      builtUpAreaSqft: 800,
      lat: 25.081,
      lng: 55.141,
      publicationStatus: "DRAFT",
      priceMinor: 100_000_000n,
    },
  ] as const;

  for (const property of properties) {
    const { priceMinor, ...propertyData } = property;
    await db.property.create({
      data: {
        ...propertyData,
        communityId: ids.community,
        developerId: ids.developer,
        sourceType: "INTERNAL",
        locationPrecision: "EXACT",
        amenities: property.id === ids.nearProperty
          ? { create: { amenityId: ids.amenity } }
          : undefined,
        listings: {
          create: {
            id: `${property.id}-listing`,
            listingType: "SALE",
            priceMinor,
            currency: "AED",
            availabilityStatus: "AVAILABLE",
            publishedAt,
          },
        },
      },
    });
  }

  await rebuildIndex();
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("PostgreSQL search projection", () => {
  test("Advisor finds a published short-term title without assuming SALE and retains other criteria", async () => {
    const listingId = `${ids.nearProperty}-listing`;
    await db.listing.update({ where: { id: listingId }, data: { listingType: "SHORT_TERM", rentFrequency: "DAILY" } });
    await reindexProperty(ids.nearProperty);
    try {
      const tool = toolByName.get("search_properties")!;
      const run = async (extra = {}) => {
        const result = await tool.execute(tool.argsSchema.parse({ q: "Zaffre Marina Residence", ...extra }));
        expect(result.ok).toBe(true);
        return result.data as { total: number; properties: { slug: string; listingType: string; rentFrequency: string; isDemoData: boolean }[] };
      };
      const found = await run();
      expect(found.properties).toHaveLength(1);
      expect(found.properties[0]).toMatchObject({ slug: `${prefix}-zaffre-residence`, listingType: "SHORT_TERM", rentFrequency: "DAILY", isDemoData: false });
      expect((await run({ listingType: "SALE" })).total).toBe(0);
      expect((await run({ listingType: "SHORT_TERM" })).total).toBe(1);
      expect((await run({ communities: ["unknown-community-that-must-not-be-removed"] })).total).toBe(0);
      expect((await run({ priceMax: 100 })).total).toBe(0);
      await db.property.update({ where: { id: ids.nearProperty }, data: { publicationStatus: "DRAFT" } });
      // Canonical visibility rejects the now-private record even before reindexing.
      expect((await run()).total).toBe(0);
    } finally {
      await db.property.update({ where: { id: ids.nearProperty }, data: { publicationStatus: "PUBLISHED" } });
      await db.listing.update({ where: { id: listingId }, data: { listingType: "SALE", rentFrequency: null } });
      await reindexProperty(ids.nearProperty);
    }
  });
  test("indexes canonical public listings and removes drafts", async () => {
    const documents = await db.searchDocument.findMany({
      where: { propertyId: { startsWith: prefix } },
      select: { propertyId: true },
    });
    const propertyIds = documents.map((document) => document.propertyId);
    expect(propertyIds).toContain(ids.nearProperty);
    expect(propertyIds).toContain(ids.arabicProperty);
    expect(propertyIds).toContain(ids.outsideProperty);
    expect(propertyIds).not.toContain(ids.draftProperty);
  });

  test("matches English typos and normalized Arabic", async () => {
    const typo = await search(searchStateSchema.parse({ q: queries[0], listingType: "SALE" }));
    expect(typo.results.map((item) => item.slug)).toContain(`${prefix}-zaffre-residence`);

    const arabic = await search(searchStateSchema.parse({ q: queries[1], listingType: "SALE" }));
    expect(arabic.results.map((item) => item.slug)).toContain(`${prefix}-arabic-villa`);
  });

  test("applies facets, bbox, radius, and scalar filters in PostgreSQL", async () => {
    const filtered = await search(searchStateSchema.parse({
      q: "zaffre",
      listingType: "SALE",
      propertyTypes: ["APARTMENT"],
      amenities: [`${prefix}-POOL`],
      bbox: [55.13, 25.07, 55.15, 25.09],
      centerLat: 25.08,
      centerLng: 55.14,
      radiusKm: 1,
    }));
    expect(filtered.results.map((item) => item.slug)).toEqual([`${prefix}-zaffre-residence`]);
    expect(filtered.total).toBe(1);
    expect(filtered.facets.propertyTypes).toEqual([{ key: "APARTMENT", count: 1 }]);
    expect(filtered.facets.amenities).toEqual([
      { key: `${prefix}-POOL`, name: "Contract Pool", count: 1 },
    ]);
  });

  test("applies polygon search and aggregates every match by zoom", async () => {
    const allState = searchStateSchema.parse({ q: "zaffre", listingType: "SALE", pageSize: 1 });
    const [coarse, fine, polygon] = await Promise.all([
      mapClustersPostgres(allState, 8),
      mapClustersPostgres(allState, 19),
      mapClustersPostgres(searchStateSchema.parse({
        listingType: "SALE",
        q: "zaffre",
        polygon: [[55.13, 25.07], [55.16, 25.07], [55.16, 25.1], [55.13, 25.1]],
      }), 19),
    ]);
    expect(coarse.total).toBeGreaterThanOrEqual(3);
    expect(coarse.total).toBe(fine.total);
    expect(coarse.clusters.length).toBeLessThan(fine.clusters.length);
    expect(polygon.total).toBe(2);
  });

  test("serves PostgreSQL search and autocomplete through HTTP", async () => {
    const [searchResponse, autocompleteResponse] = await Promise.all([
      fetch(`${baseUrl}/api/search?q=${encodeURIComponent(queries[0])}&type=sale`),
      fetch(`${baseUrl}/api/search/autocomplete?q=${encodeURIComponent("الامارات")}`),
    ]);
    expect(searchResponse.status).toBe(200);
    expect(autocompleteResponse.status).toBe(200);
    const searchBody = await searchResponse.json() as { results: { slug: string }[] };
    const autocompleteBody = await autocompleteResponse.json() as { items: { slug: string }[] };
    expect(searchBody.results.map((item) => item.slug)).toContain(`${prefix}-zaffre-residence`);
    expect(autocompleteBody.items.map((item) => item.slug)).toContain(`${prefix}-arabic-villa`);
  });

  test("outbox-style reindex removes a listing that becomes non-public", async () => {
    await db.property.update({
      where: { id: ids.nearProperty },
      data: { publicationStatus: "DRAFT" },
    });
    await reindexProperty(ids.nearProperty);
    expect(await db.searchDocument.count({ where: { propertyId: ids.nearProperty } })).toBe(0);

    const staleCheck = await search(searchStateSchema.parse({ q: queries[0], listingType: "SALE" }));
    expect(staleCheck.results.map((item) => item.slug)).not.toContain(`${prefix}-zaffre-residence`);
  });

  test("expired canonical listings are excluded even before a projection refresh", async () => {
    const listingId = `${ids.arabicProperty}-listing`;
    await db.listing.update({ where: { id: listingId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    try {
      const state = searchStateSchema.parse({ q: "zaffre", listingType: "SALE" });
      const result = await mapClustersPostgres(state, 19);
      expect(result.clusters.some((cluster) => cluster.listingId === listingId)).toBe(false);
      expect((await autocomplete("الامارات")).some((item) => item.slug === `${prefix}-arabic-villa`)).toBe(false);
      expect((await fetch(`${baseUrl}/api/map/selection?slug=${prefix}-arabic-villa`)).status).toBe(404);
    } finally { await db.listing.update({ where: { id: listingId }, data: { expiresAt: null } }); }
  });

  test("projection query failure falls back to current canonical visibility", async () => {
    if (!["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Projection outage fixture requires the disposable database.");
    // Prisma's method proxy does not reliably accept method spies. Temporarily
    // remove the projection name in the disposable stack, keeping canonical
    // tables intact and restoring the same table even when an assertion fails.
    cache.invalidatePrefix("search:");
    await db.$executeRaw`ALTER TABLE "SearchDocument" RENAME TO "SearchDocument_projection_fault"`;
    try {
      const result = await search(searchStateSchema.parse({ q: "zaffre", communities: ["pg-search-contract-community"], sort: "newest", pageSize: 48 }));
      expect(result.degraded).toBe(true);
      expect(result.results.map((row) => row.slug)).toContain(`${prefix}-arabic-villa`);
      expect(result.results.map((row) => row.slug)).not.toContain(`${prefix}-zaffre-residence`);
      expect(result.results.map((row) => row.slug)).not.toContain(`${prefix}-draft`);
    } finally {
      await db.$executeRaw`ALTER TABLE "SearchDocument_projection_fault" RENAME TO "SearchDocument"`;
      cache.invalidatePrefix("search:");
    }
  });
});

import { describe, expect, test } from "bun:test";
import { listingCardDtoSchema, priceDtoSchema, searchResponseSchema } from "@/lib/contracts";

const listing = {
  id: "listing-1",
  slug: "contract-listing",
  title: "Contract listing",
  propertyType: "APARTMENT",
  listingType: "SALE" as const,
  bedrooms: 2,
  bathrooms: 2,
  areaSqft: 1200,
  price: { minor: "215000000", currency: "AED", qualifier: null, rentFrequency: null },
  availabilityStatus: "AVAILABLE",
  offPlan: false,
  isFeatured: false,
  isExclusive: false,
  community: { id: "community-1", name: "Community", slug: "community" },
  project: null,
  developer: null,
  agent: null,
  cover: null,
  lat: 25.2,
  lng: 55.3,
  handoverQuarter: null,
  view: null,
  furnishing: null,
  isDemoData: false,
};

describe("shared public DTO contracts", () => {
  test("money crosses JSON boundaries as decimal minor-unit strings", () => {
    expect(priceDtoSchema.parse({ minor: "215000000", currency: "AED" }).minor).toBe("215000000");
    expect(() => priceDtoSchema.parse({ minor: 215000000, currency: "AED" })).toThrow();
    expect(() => priceDtoSchema.parse({ minor: "2150.00", currency: "AED" })).toThrow();
  });

  test("listing cards reject invalid coordinates and listing types", () => {
    expect(listingCardDtoSchema.parse(listing).slug).toBe("contract-listing");
    expect(() => listingCardDtoSchema.parse({ ...listing, lat: 125.2 })).toThrow();
    expect(() => listingCardDtoSchema.parse({ ...listing, listingType: "LEASE" })).toThrow();
  });

  test("search response locks pagination and facet serialization", () => {
    const response = {
      results: [listing],
      total: 1,
      page: 1,
      pageSize: 12,
      tookMs: 2,
      facets: {
        total: 1,
        communities: [{ ...listing.community, count: 1 }],
        propertyTypes: [{ key: "APARTMENT", count: 1 }],
        priceBuckets: [{ key: "all", minMinor: "0", maxMinor: null, count: 1 }],
        bedroomCounts: [{ key: 2, count: 1 }],
        amenities: [],
        developers: [],
        views: [],
      },
    };
    expect(searchResponseSchema.parse(response).results).toHaveLength(1);
    expect(() => searchResponseSchema.parse({ ...response, page: 0 })).toThrow();
  });
});

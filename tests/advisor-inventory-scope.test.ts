import { describe, expect, test } from "bun:test";
import { advisorListingTypes, advisorListingTypeSchema } from "@/server/ai/inventory-listing-scope";
import { LocalSearchProvider } from "@/server/search/local-provider";
import { searchStateSchema, type IndexedProperty } from "@/server/search/types";
import { propertyCards } from "@/server/ai/attachments";

function document(type: "SALE" | "RENT" | "SHORT_TERM", price: bigint): IndexedProperty {
  return {
    id: type, propertyId: type, slug: type.toLowerCase(), title: "Concord Fixture Tower", listingType: type,
    propertyType: "APARTMENT", bedrooms: 2, bathrooms: 2, areaSqft: 1000, priceMinor: price, currency: "AED",
    priceQualifier: null, rentFrequency: type === "SHORT_TERM" ? "DAILY" : null,
    availabilityStatus: "AVAILABLE", offPlan: false, isFeatured: false, isExclusive: false, furnished: false,
    communityId: "fixture", communityName: "Fixture", communitySlug: "fixture", projectId: null,
    projectName: null, projectSlug: null, projectStatus: null, developerId: null, developerName: null,
    developerSlug: null, agentId: null, agentSlug: null, amenities: [], lat: 25.08, lng: 55.14,
    publishedAt: 1, handoverQuarter: null, view: null, coverUrl: null, coverAlt: null, coverWidth: null,
    coverHeight: null, paymentPlanDownPercent: null, isDemoData: true,
    furnishing: null, communityAreaType: "WATERFRONT", communityAvgPsqft: null,
    communityYieldPct: null, paymentPlanPostHandover: null,
    tokens: new Set(["concord", "fixture", "tower"]),
  };
}

describe("Advisor inventory listing scope", () => {
  test("cards retain recorded transaction type and rental frequency without inventing missing values", () => {
    const cards = propertyCards({ properties: [
      { slug: "concord-fixture", title: "Concord Fixture", listingType: "SHORT_TERM", rentFrequency: "DAILY", priceAed: 500, isDemoData: true, sourceType: "INDEX" },
      { slug: "older-result", title: "Older result", priceAed: 100 },
    ] });
    expect(cards[0]).toMatchObject({ listingType: "SHORT_TERM", rentFrequency: "DAILY", source: { state: "ILLUSTRATIVE" } });
    expect(cards[1]).toMatchObject({ listingType: null, rentFrequency: null });
  });
  test("accepts short-term requests and rejects unsupported types", () => {
    expect(advisorListingTypeSchema.parse("SHORT_TERM")).toBe("SHORT_TERM");
    expect(advisorListingTypeSchema.safeParse("ANY").success).toBe(false);
    expect(advisorListingTypes()).toEqual(["SALE", "RENT", "SHORT_TERM"]);
    expect(advisorListingTypes("RENT")).toEqual(["RENT"]);
  });
  test("all-type search keeps global sorting, total, pagination and criteria", () => {
    const provider = new LocalSearchProvider();
    for (const [type, price] of [["SALE", 200000000n], ["RENT", 10000000n], ["SHORT_TERM", 50000n]] as const) provider.upsert(document(type, price));
    const state = searchStateSchema.parse({ q: "Concord", communities: ["fixture"], sort: "price_asc", pageSize: 2 });
    const scope = { ...state, inventoryListingTypes: advisorListingTypes() };
    expect(provider.search(scope).ids).toEqual(["SHORT_TERM", "RENT"]);
    expect(provider.search(scope).total).toBe(3);
    expect(provider.search({ ...scope, page: 2 }).ids).toEqual(["SALE"]);
    expect(provider.search({ ...scope, communities: ["unknown"] }).total).toBe(0);
    expect(provider.search({ ...scope, priceMax: 600 }).ids).toEqual(["SHORT_TERM"]);
    expect(provider.search({ ...scope, inventoryListingTypes: [] }).total).toBe(0);
    // Ordinary public searches retain their default SALE scope.
    expect(provider.search(state).ids).toEqual(["SALE"]);
    expect(provider.search({ ...state, inventoryListingTypes: advisorListingTypes("RENT") }).ids).toEqual(["RENT"]);
  });
});

import { describe, expect, test } from "bun:test";
import { normalizeSearchText, searchTokens } from "@/server/search/normalize";
import { queryToSearchState, searchStateToQuery, searchStateSchema } from "@/server/search/types";

describe("search normalization", () => {
  test("normalizes Arabic presentation variants without dropping Arabic tokens", () => {
    expect(normalizeSearchText("إِمَارَات ـ عقاريّة")).toBe("امارات عقاريه");
    expect(searchTokens("شقة في دُبي Marina")).toEqual(["شقه", "في", "دبي", "marina"]);
  });

  test("normalizes Unicode compatibility forms and punctuation deterministically", () => {
    expect(normalizeSearchText("ＭＡＲＩＮＡ—View  ２BR")).toBe("marina view 2br");
  });
});

describe("SearchState URL contract", () => {
  test("round-trips every persisted filter", () => {
    const state = searchStateSchema.parse({
      q: "دبي marina",
      listingType: "RENT",
      propertyTypes: ["APARTMENT"],
      communities: ["dubai-marina"],
      developers: ["dev"],
      projects: ["project"],
      agents: ["advisor"],
      priceMin: 1000,
      priceMax: 5000,
      bedroomsMin: 1,
      bedroomsMax: 3,
      bathroomsMin: 2,
      areaMin: 700,
      areaMax: 1600,
      amenities: ["POOL"],
      offPlan: false,
      furnished: true,
      exclusive: true,
      featured: true,
      availability: ["AVAILABLE"],
      projectStatus: ["ACTIVE"],
      paymentPlanMaxDown: 25,
      handoverBy: "Q4 2028",
      views: ["MARINA"],
      furnishings: ["FURNISHED"],
      ppsfMin: 900,
      ppsfMax: 2100,
      yieldMin: 6,
      handoverFromYear: 2026,
      handoverToYear: 2029,
      postHandoverPlan: true,
      smart: ["waterfront"],
      sort: "price_asc",
      page: 3,
      pageSize: 24,
      bbox: [55.1, 25.0, 55.4, 25.4],
      radiusKm: 12,
      centerLat: 25.2,
      centerLng: 55.3,
      polygon: [[55.1, 25.0], [55.4, 25.0], [55.2, 25.4]],
    });

    expect(queryToSearchState(searchStateToQuery(state))).toEqual(state);
  });
});

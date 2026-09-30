import { describe, expect, test } from "bun:test";
import { withSearchFallback } from "@/server/search/resilience";
import { listingExclusionReasons } from "@/server/search/diagnostics";
import { mapBounds, mapViewport, validMapPoint } from "@/lib/map-state";
import { queryToSearchState } from "@/server/search/types";
describe("production discovery recovery", () => {
  test("uses primary results when healthy and explicit fresh fallback on provider failure", async () => {
    let fallbackCalls = 0;
    expect(await withSearchFallback(async () => ["index"], async () => { fallbackCalls++; return ["canonical"]; })).toEqual({ value: ["index"], degraded: false });
    expect(fallbackCalls).toBe(0);
    expect(await withSearchFallback(async () => { throw new Error("index down"); }, async () => ["canonical"])).toEqual({ value: ["canonical"], degraded: true });
  });
  test("both paths failing returns retryable unavailable, never a fabricated empty result", async () => {
    await expect(withSearchFallback(async () => { throw new Error("projection down"); }, async () => { throw new Error("database down"); })).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });
  });
  test("bounded viewport and searched bbox use distinct URL values", () => {
    expect(mapViewport({ c: "25.1,55.2", z: "21" })).toEqual({ center: [25.1, 55.2], zoom: 19 });
    expect(mapViewport({ c: "95,999", z: "bad" })).toEqual({ center: [25.1, 55.2], zoom: 11 });
    expect(mapBounds("55,25,56,26")).toEqual([55, 25, 56, 26]);
    for (const value of ["56,26,55,25", "nan,25,56,26", "55,25,999,26", "55,25,56"]) {
      expect(mapBounds(value)).toBeNull(); expect(() => queryToSearchState({ bbox: value })).toThrow();
    }
    expect(validMapPoint(Infinity, 55)).toBe(false);
  });
  test("index diagnostics expose every applicable publication and geometry exclusion", () => {
    expect(listingExclusionReasons({ publishedAt: null, expiresAt: new Date("2020-01-01"), availabilityStatus: "WITHDRAWN", property: { publicationStatus: "DRAFT", deletedAt: new Date(), lat: 95, lng: 55 } })).toEqual(["PROPERTY_PRIVATE", "PROPERTY_DELETED", "LISTING_UNPUBLISHED", "LISTING_EXPIRED", "LISTING_WITHDRAWN", "INVALID_COORDINATES"]);
  });
});

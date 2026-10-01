import { describe, expect, test } from "bun:test";
import { propertyPublicationChecks, type PropertyPublicationInput } from "@/lib/property-publication";
const now = new Date("2026-10-01T00:00:00Z");
const valid: PropertyPublicationInput = { title: "Synthetic property", propertyType: "APARTMENT", bedrooms: 2, bathrooms: 2,
  lat: 25, lng: 55, communityStatus: "PUBLISHED", projectSelected: false, projectPublic: false, listingType: "SALE",
  listings: [{ pricePositive: true, availability: "AVAILABLE", publishedAt: now, expiresAt: null }] };
describe("shared property publication", () => {
  test("a valid new listing can publish immediately", () => expect(propertyPublicationChecks(valid, now).every(row => row.ready)).toBe(true));
  test("reports location and private parent fields", () => {
    const issues = propertyPublicationChecks({ ...valid, lat: NaN, communityStatus: "DRAFT", projectSelected: true }, now).filter(row => !row.ready);
    expect(issues.map(row => row.path)).toEqual(["lat", "communityId", "projectId"]);
  });
  test("expired, withdrawn, unpublished and unpriced listings cannot publish", () => {
    for (const patch of [{ expiresAt: now }, { availability: "WITHDRAWN" }, { publishedAt: null }, { pricePositive: false }]) {
      expect(propertyPublicationChecks({ ...valid, listings: [{ ...valid.listings[0], ...patch }] }, now).some(row => !row.ready)).toBe(true);
    }
  });
  test("rental frequency and whole room counts are validated", () => {
    expect(propertyPublicationChecks({ ...valid, listingType: "RENT", bedrooms: 31 }, now).filter(row => !row.ready).map(row => row.path)).toEqual(["bedrooms", "listingType"]);
    expect(propertyPublicationChecks({ ...valid, listingType: "RENT", rentFrequency: "MONTHLY" }, now).every(row => row.ready)).toBe(true);
  });
});

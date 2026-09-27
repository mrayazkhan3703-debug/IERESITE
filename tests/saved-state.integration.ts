import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `saved-state-user-${suffix}`;
const communityId = `saved-state-community-${suffix}`;
const propertyId = `saved-state-property-${suffix}`;
const propertySlug = `saved-state-property-${suffix}`;
let cookie = "";

function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      "x-requested-with": "fetch",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  const customer = await db.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
  await db.user.create({ data: { id: userId, email: `saved-${suffix}@example.invalid`, emailVerified: new Date(), roles: { create: { roleId: customer.id } } } });
  await db.community.create({ data: { id: communityId, name: "Saved-state community", slug: `saved-community-${suffix}`, lat: 25.2, lng: 55.3 } });
  await db.property.create({ data: { id: propertyId, communityId, title: "Saved-state property", slug: propertySlug, lat: 25.2, lng: 55.3, publicationStatus: "PUBLISHED", locationPrecision: "APPROXIMATE" } });
  cookie = `ie_session=${await createSession(userId)}`;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.property.deleteMany({ where: { id: propertyId } });
  await db.community.deleteMany({ where: { id: communityId } });
  await db.$disconnect();
});

describe("durable account saved state", () => {
  test("persists preferences, favorites, recent history, and comparison tray", async () => {
    expect((await request("/api/account/preferences", "PATCH", { locale: "ar", currency: "usd", marketingOptIn: true })).status).toBe(200);
    expect((await request("/api/favorites", "POST", { propertySlug })).status).toBe(200);
    expect((await request("/api/recently-viewed", "POST", { propertySlug })).status).toBe(200);
    expect((await request("/api/account/comparisons", "PUT", { propertySlugs: [propertySlug] })).status).toBe(200);

    const preferences = await (await request("/api/account/preferences")).json() as { locale: string; currency: string; marketingOptIn: boolean };
    expect(preferences).toMatchObject({ locale: "ar", currency: "USD", marketingOptIn: true });
    const favorites = await (await request("/api/favorites")).json() as { favorites: Array<{ slug: string }> };
    expect(favorites.favorites.map((item) => item.slug)).toEqual([propertySlug]);
    const recent = await (await request("/api/recently-viewed")).json() as { recentlyViewed: Array<{ slug: string }> };
    expect(recent.recentlyViewed.map((item) => item.slug)).toEqual([propertySlug]);
    const comparison = await (await request("/api/account/comparisons")).json() as { comparison: { properties: Array<{ slug: string }> } };
    expect(comparison.comparison.properties.map((item) => item.slug)).toEqual([propertySlug]);

    expect((await request("/api/recently-viewed", "DELETE")).status).toBe(200);
    const cleared = await (await request("/api/recently-viewed")).json() as { recentlyViewed: unknown[] };
    expect(cleared.recentlyViewed).toHaveLength(0);
  });
});

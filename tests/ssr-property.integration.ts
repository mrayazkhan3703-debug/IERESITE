import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";

const baseUrl = process.env.TEST_BASE_URL ?? "http://host.docker.internal:3000";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const communityId = `ssr-community-${suffix}`;
const propertyId = `ssr-property-${suffix}`;
const listingId = `ssr-listing-${suffix}`;
const redirectId = `ssr-redirect-${suffix}`;
const redirectPath = `/ssr-legacy-${suffix}`;
const propertySlug = `ssr-property-${suffix}`;
const propertyTitle = `SSR contract property ${suffix}`;

async function cleanup() {
  await db.sitemapEntry.deleteMany({ where: { section: "properties", path: `/properties/${propertySlug}` } });
  await db.redirect.deleteMany({ where: { id: redirectId } });
  await db.property.deleteMany({ where: { id: propertyId } });
  await db.community.deleteMany({ where: { id: communityId } });
}

beforeAll(async () => {
  await cleanup();
  await db.community.create({
    data: {
      id: communityId,
      name: "SSR Contract Community",
      slug: `ssr-community-${suffix}`,
      lat: 25.2048,
      lng: 55.2708,
      publicationStatus: "PUBLISHED",
      locationPrecision: "APPROXIMATE",
    },
  });
  await db.property.create({
    data: {
      id: propertyId,
      communityId,
      title: propertyTitle,
      slug: propertySlug,
      shortDescription: "Server-rendered property contract fixture.",
      bedrooms: 2,
      bathrooms: 2,
      builtUpAreaSqft: 1234,
      lat: 25.2048,
      lng: 55.2708,
      publicationStatus: "PUBLISHED",
      locationPrecision: "APPROXIMATE",
    },
  });
  await db.listing.create({
    data: {
      id: listingId,
      propertyId,
      priceMinor: 250_000_000n,
      currency: "AED",
      availabilityStatus: "AVAILABLE",
      publishedAt: new Date(Date.now() - 60_000),
    },
  });
  await db.redirect.create({
    data: {
      id: redirectId,
      fromPath: redirectPath,
      toPath: `/properties/${propertySlug}`,
      statusCode: 301,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("server-rendered property detail", () => {
  test("returns crawlable content and server-native metadata", async () => {
    const response = await fetch(`${baseUrl}/properties/${propertySlug}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(propertyTitle);
    expect(html).toContain("Server-rendered property contract fixture.");
    expect(html).toContain(`rel="canonical" href="http://localhost:3000/properties/${propertySlug}"`);
    expect(html).toContain(`hrefLang="ar" href="http://localhost:3000/ar/properties/${propertySlug}"`);
    expect(html).toContain('"@type":"RealEstateListing"');
    expect(html).toContain('name="robots" content="index, follow"');
  });

  test("uses the framework not-found boundary and HTTP 404", async () => {
    const response = await fetch(`${baseUrl}/properties/ssr-missing-${suffix}`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("Page not found");
    expect(html).toContain("noindex");
  });

  test("publishes native robots and a visibility-filtered sitemap", async () => {
    const [robotsResponse, sitemapResponse] = await Promise.all([
      fetch(`${baseUrl}/robots.txt`),
      fetch(`${baseUrl}/sitemap.xml`),
    ]);
    const robots = await robotsResponse.text();
    const sitemap = await sitemapResponse.text();

    expect(robotsResponse.status).toBe(200);
    expect(robots).toContain("Sitemap: http://localhost:3000/sitemap.xml");
    expect(robots).toContain("Disallow: /admin/");
    expect(robots).toContain("Disallow: /ar/account/");
    expect(robots).toContain("Disallow: /ar/admin/");
    expect(robots).toContain("Disallow: /ar/compare");
    expect(sitemapResponse.status).toBe(200);
    expect(sitemap).toContain(`http://localhost:3000/properties/${propertySlug}`);
  });

  test("applies database redirect history at the HTTP boundary", async () => {
    const response = await fetch(`${baseUrl}${redirectPath}?source=contract`, { redirect: "manual" });

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`/properties/${propertySlug}?source=contract`);
  });

  test("renders URL-selected Arabic language and direction on the server", async () => {
    const response = await fetch(`${baseUrl}/ar/properties/${propertySlug}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<html lang="ar" dir="rtl"');
    expect(html).toContain("تخطَّ إلى المحتوى الرئيسي");
    expect(html).toContain(propertyTitle);
    expect(html).toContain(`rel="canonical" href="http://localhost:3000/ar/properties/${propertySlug}"`);
  });

  test("serves known legacy views through a validated App Router boundary", async () => {
    const [known, unknown, invalidCalculator, invalidAccount, missingProject, arabicPrivate] = await Promise.all([
      fetch(`${baseUrl}/about`),
      fetch(`${baseUrl}/definitely-not-an-iere-route-${suffix}`),
      fetch(`${baseUrl}/calculators/not-a-tool`),
      fetch(`${baseUrl}/account/not-a-page`),
      fetch(`${baseUrl}/projects/missing-project-${suffix}`),
      fetch(`${baseUrl}/ar/account/preferences`),
    ]);
    const knownHtml = await known.text();

    expect(known.status).toBe(200);
    expect(knownHtml).toContain("<title>About | Investment Experts</title>");
    expect(knownHtml).toContain('rel="canonical" href="http://localhost:3000/about"');
    expect(unknown.status).toBe(404);
    expect(invalidCalculator.status).toBe(404);
    expect(invalidAccount.status).toBe(404);
    expect(missingProject.status).toBe(404);
    expect(arabicPrivate.status).toBe(200);
    expect(await arabicPrivate.text()).toContain('name="robots" content="noindex, nofollow"');
  });
});

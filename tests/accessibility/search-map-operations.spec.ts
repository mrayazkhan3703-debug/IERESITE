import { expect, test } from "./fixtures";
import type { ListingCardDTO } from "@/lib/types";
function listing(id: string, title: string): ListingCardDTO {
  return { id, slug: id, title, propertyType: "APARTMENT", listingType: "SALE", bedrooms: 2, bathrooms: 2, areaSqft: 1200, price: { minor: "125000000", currency: "AED", qualifier: null, rentFrequency: null }, availabilityStatus: "AVAILABLE", offPlan: false, isFeatured: false, isExclusive: false, community: { id: "synthetic-map", name: "Synthetic map fixture", slug: "synthetic-map" }, project: null, developer: null, agent: null, cover: null, lat: 25.1, lng: 55.2, handoverQuarter: null, view: null, isDemoData: true };
}
const cards = [listing("synthetic-map-first", "Synthetic first listing"), listing("synthetic-map-second", "Synthetic second listing")];
const payload = { results: cards, total: 2, clusters: [{ lat: 25.1, lng: 55.2, count: 2, listingId: null, slug: null, title: null, priceMinor: null, currency: null }], communities: [], projects: [], clusterCoverage: "FULL" };

for (const locale of ["en", "ar"] as const) test(`${locale} singleton pin markers survive navigation, style changes and repeated mounts`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const singletons = cards.map((item, index) => ({ ...item, lat: item.lat + index * 0.08 }));
  await page.route("**/api/map?*", (route) => route.fulfill({ json: { ...payload, results: singletons, clusters: singletons.map((item) => ({ lat: item.lat, lng: item.lng, count: 1, listingId: item.id, slug: item.slug, title: item.title, priceMinor: item.price.minor, currency: "AED" })) } }));
  await page.route("**/api/market/metrics?*", (route) => route.fulfill({ json: { metrics: [] } }));
  const prefix = locale === "ar" ? "/ar" : "";
  await page.goto(`${prefix}/market/transactions`);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator(`footer a[href="${prefix}/properties/map"]`).click();
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
    await expect(page.locator(".ie-property-pin svg")).toHaveCount(2);
    const pin = page.getByRole("button", { name: /Synthetic first listing —/ });
    await pin.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe("synthetic-map-first");
    await page.reload();
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe("synthetic-map-first");
    await page.getByRole("button", { name: locale === "ar" ? "أغلق المعاينة" : "Close preview", exact: true }).click();
    await expect(page.locator(".ie-property-pin svg")).toHaveCount(2);
    await page.getByRole("button", { name: locale === "ar" ? "شريط السعر" : "Price pill", exact: true }).click();
    await expect(page.locator(".ie-property-pin svg")).toHaveCount(0);
    await page.getByRole("button", { name: locale === "ar" ? "دبوس" : "Pin", exact: true }).click();
    await expect(page.locator(".ie-property-pin svg")).toHaveCount(2);
    await page.locator(`footer a[href="${prefix}/market/transactions"]`).click();
    await expect(page.getByRole("heading", { name: "Sale transactions explorer", exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("map selects coincident listings by identity and preserves the searched area through pan and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let requests = 0;
  await page.route("**/api/map?*", async (route) => { requests++; await route.fulfill({ json: payload }); });
  await page.route("**/api/market/metrics?*", (route) => route.fulfill({ json: { metrics: [] } }));
  await page.goto("/properties/map?c=25.1,55.2&z=11&marker=price");
  const rail = page.getByRole("complementary", { name: "Results list" });
  const second = rail.getByRole("button", { name: /Synthetic second listing/ });
  await expect(second).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).not.toBeNull();
  const searchedArea = new URL(page.url()).searchParams.get("bbox");
  const beforeSelection = requests;
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe("synthetic-map-second");
  expect(requests).toBe(beforeSelection);
  await page.reload();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(searchedArea);
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  const bounds = await map.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * .65, bounds!.y + bounds!.height * .45);
  await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width * .45, bounds!.y + bounds!.height * .45, { steps: 10 }); await page.mouse.up();
  await expect(page.getByRole("button", { name: "Search this area", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("bbox")).toBe(searchedArea);
  await page.getByRole("button", { name: "Search this area", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("bbox")).not.toBe(searchedArea);
  expect(new URL(page.url()).searchParams.get("marker")).toBe("price");
  expect(errors).toEqual([]);
});

for (const locale of ["en", "ar"] as const) test(`${locale} mobile map distinguishes an outage from empty inventory and recovers on retry`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route("**/api/map?*", (route) => route.fulfill(fail ? { status: 503, json: { error: "Synthetic projection outage" } } : { json: { ...payload, degraded: true, clusterCoverage: "PAGE_ONLY" } }));
  await page.route("**/api/market/metrics?*", (route) => route.fulfill({ json: { metrics: [] } }));
  await page.goto(`${locale === "ar" ? "/ar" : ""}/properties/map`);
  const retry = page.getByRole("button", { name: locale === "ar" ? "أعد تحميل نتائج الخريطة" : "Retry map results", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText(locale === "ar" ? "لا شيء في هذه المنطقة" : "Nothing in this area", { exact: true })).toHaveCount(0);
  fail = false; await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByText(locale === "ar" ? /وضع استعادة البحث/ : /Search index recovery mode/)).toBeVisible();
  await page.getByRole("button", { name: locale === "ar" ? /القائمة 2/ : /List 2/ }).click();
  await expect(page.getByRole("button", { name: /Synthetic second listing/ }).last()).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

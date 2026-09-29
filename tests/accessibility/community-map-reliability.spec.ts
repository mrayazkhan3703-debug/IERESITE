import { expect, test } from "./fixtures";

test("community images fall back safely and community/map routes survive repeated navigation", async ({ page }) => {
  const errors: string[] = [];
  const missingAssets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() === 404 && new URL(response.url()).pathname.startsWith("/images/communities/")) {
      missingAssets.push(new URL(response.url()).pathname);
    }
  });
  await page.route("**/api/communities", (route) => route.fulfill({ json: { communities: [{
    id: "synthetic-community-image", slug: "dubai-marina", name: "SYNTHETIC Dubai Marina", summary: "Synthetic browser fixture.",
    areaType: "RESIDENTIAL", listingCount: 1, avgPricePerSqft: null, image: null, lat: 25.08, lng: 55.14, lifestyleTags: ["Synthetic"],
  }] } }));
  await page.route("**/api/map?*", (route) => route.fulfill({ json: {
    results: [], total: 0, clusters: [], projects: [], communities: [{ id: "synthetic-community-image", slug: "dubai-marina", name: "SYNTHETIC Dubai Marina", lat: 25.08, lng: 55.14, radiusMeters: 1200 }],
  } }));
  await page.route("**/api/market/metrics?*", (route) => route.fulfill({ json: { metrics: [] } }));

  await page.goto("/communities");
  const image = page.getByRole("img", { name: "SYNTHETIC Dubai Marina, Dubai" });
  await expect(image).toHaveAttribute("src", "/images/communities/dubai-marina.jpg");
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('a[href="/properties/map"]').last().click();
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
    await page.locator('a[href="/communities"]').last().click();
    await expect(page.getByRole("heading", { name: "Explore Dubai, community by community" })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(missingAssets).toEqual([]);
});

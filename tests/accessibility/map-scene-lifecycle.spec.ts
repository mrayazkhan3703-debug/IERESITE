import type { Page } from "@playwright/test";
import type { ProjectDetailV2 } from "@/components/project/project-shared";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    __sceneAudit: { draws: number; releases: number; probes: number; hidden: boolean; drawsByHost: Record<string, number>; releasesByHost: Record<string, number> };
  }
}

// Actual pinned Chromium software WebGL2, not a fabricated successful context.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const db = new PrismaClient();
test.afterAll(async () => { await db.$disconnect(); });

async function atlasFixture(page: Page) {
  // Explicit synthetic UI-only fixture. No metrics, provider data or DB writes.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payloads: Record<string, unknown> = {
      "/api/communities": { communities: [{ id: "synthetic-lifecycle", slug: "synthetic-lifecycle", name: "SYNTHETIC lifecycle community", lat: 25.12, lng: 55.2, listingCount: 0 }] },
      "/api/market/metrics": { metrics: [] },
      "/api/market/transactions": { byCommunity: [] },
      "/api/market/rents": { byCommunity: [] },
      "/api/map": { projects: [] },
    };
    if (path in payloads) await route.fulfill({ json: payloads[path] });
    else await route.fallback();
  });
}

async function instrumentRenderer(page: Page) {
  await page.addInitScript(() => {
    window.__sceneAudit = { draws: 0, releases: 0, probes: 0, hidden: false, drawsByHost: {}, releasesByHost: {} };
    // Controlled visibility branch; not an OS background-tab certification.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__sceneAudit.hidden });
    for (const method of ["drawElements", "drawArrays"] as const) {
      const original = WebGL2RenderingContext.prototype[method];
      Object.defineProperty(WebGL2RenderingContext.prototype, method, {
        value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
          const host = (this.canvas as HTMLCanvasElement).parentElement?.dataset.sceneHost;
          if (host) window.__sceneAudit.drawsByHost[host] = (window.__sceneAudit.drawsByHost[host] ?? 0) + 1;
          if (host === "atlas") window.__sceneAudit.draws++;
          return Reflect.apply(original, this, args);
        },
      });
    }
    const wrapped = new WeakSet<object>();
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name: string) {
      const extension = Reflect.apply(getExtension, this, [name]);
      if (name === "WEBGL_lose_context" && extension && !wrapped.has(extension)) {
        wrapped.add(extension);
        const lose = extension.loseContext.bind(extension);
        const canvas = this.canvas as HTMLCanvasElement;
        extension.loseContext = () => {
          const host = canvas.parentElement?.dataset.sceneHost;
          if (host) window.__sceneAudit.releasesByHost[host] = (window.__sceneAudit.releasesByHost[host] ?? 0) + 1;
          if (canvas.parentElement?.dataset.sceneHost === "atlas") window.__sceneAudit.releases++;
          else if (!host) window.__sceneAudit.probes++;
          lose();
        };
      }
      return extension;
    };
  });
}

test("Atlas software renderer pauses hidden/offscreen work and releases repeated mounts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await atlasFixture(page);
  await instrumentRenderer(page);
  await page.goto("/atlas?mode=3d");
  const scene = page.locator('[data-scene-host="atlas"]');
  await expect(scene.locator("canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.draws)).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.probes)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__sceneAudit.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const paused = await page.evaluate(() => window.__sceneAudit.draws);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__sceneAudit.draws)).toBe(paused);
  await page.evaluate(() => {
    window.__sceneAudit.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.draws)).toBeGreaterThan(paused);

  await scene.evaluate((host) => { (host as HTMLElement).style.transform = "translateY(5000px)"; });
  await page.waitForTimeout(180); // Allow actual IntersectionObserver notification.
  const offscreen = await page.evaluate(() => window.__sceneAudit.draws);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__sceneAudit.draws)).toBe(offscreen);
  await scene.evaluate((host) => { (host as HTMLElement).style.transform = ""; });
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.draws)).toBeGreaterThan(offscreen);

  for (let cycle = 1; cycle <= 3; cycle++) {
    await page.getByRole("tab", { name: "2D map", exact: true }).click();
    await expect(scene).toHaveCount(0);
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
    await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(1);
    if (cycle === 1) {
      await page.getByRole("button", { name: "Communities", exact: true }).click();
      await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(0);
      await page.getByRole("button", { name: "Communities", exact: true }).click();
      await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(1);
    }
    await expect.poll(() => page.evaluate(() => window.__sceneAudit.releases)).toBe(cycle);
    await page.getByRole("tab", { name: "3D view", exact: true }).click();
    await expect(scene.locator("canvas")).toHaveCount(1);
    await expect(scene.locator("canvas")).toBeVisible();
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("project massing and unit-stack loss release their contexts and show DOM alternatives", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Synthetic UI-only contract; no property/developer/price/metric claims or writes.
  const project: ProjectDetailV2 = {
    id: "synthetic-scene", slug: "synthetic-scene", name: "SYNTHETIC scene project", tagline: null,
    summary: null, description: null, status: "OFF_PLAN", projectType: "APARTMENT", launchDate: null,
    handoverDate: null, completionPercent: null, constructionStatus: null, constructionSourceUrl: null,
    constructionSourceVerifiedAt: null, totalUnits: null, startingPriceMinor: null, currency: "AED", lat: 25.12, lng: 55.2,
    highlights: [], keyAmenities: [], developer: { id: "synthetic", slug: "synthetic", name: "SYNTHETIC developer", summary: null, verificationStatus: "UNVERIFIED", lastVerifiedAt: null },
    community: { id: "synthetic", slug: "synthetic", name: "SYNTHETIC community", summary: null, lat: 25.12, lng: 55.2 },
    media: [], amenities: [], paymentPlans: [], documents: [], statusHistory: [], availableProperties: [], advisors: [],
    isDemoData: true, sourceVerifiedAt: null,
    units: [{ id: "synthetic-unit", unitNumber: "A-101", unitType: "APARTMENT", bedrooms: 0, bathrooms: 0, areaSqft: null,
      priceMinor: null, currency: "AED", availabilityStatus: "AVAILABLE", floor: 1, aspect: null, propertySlug: null }],
  };
  const fixtureId = `native-scene-${crypto.randomUUID()}`;
  try {
  // Native pages correctly validate visibility server-side. A uniquely owned,
  // explicitly synthetic project replaces the old client-router 404 bypass.
  await db.$transaction(async (tx) => {
    await tx.community.create({ data: { id: fixtureId, slug: fixtureId, name: "SYNTHETIC scene fixture", lat: 25.12, lng: 55.2, publicationStatus: "PUBLISHED", isDemoData: true, locationPrecision: "APPROXIMATE" } });
    await tx.developer.create({ data: { id: fixtureId, slug: fixtureId, name: "SYNTHETIC scene fixture", isDemoData: true } });
    await tx.project.create({ data: { id: fixtureId, slug: fixtureId, name: "SYNTHETIC scene fixture", developerId: fixtureId, communityId: fixtureId, lat: 25.12, lng: 55.2, publicationStatus: "PUBLISHED", isDemoData: true, locationPrecision: "APPROXIMATE" } });
    await tx.seoMetadata.create({ data: { routeKey: `projects/${fixtureId}`, title: "SYNTHETIC native server title" } });
  });
  project.id = fixtureId;
  project.slug = fixtureId;
  await page.route(`**/api/projects/${fixtureId}`, (route) => route.fulfill({ json: project }));
  await page.route("**/api/communities/synthetic", (route) => route.fulfill({ status: 404, json: { error: "Synthetic context intentionally unavailable" } }));
  await atlasFixture(page);
  await instrumentRenderer(page);
  await page.goto(`/projects/${fixtureId}`);
  await page.locator("#twin-massing-heading").scrollIntoViewIfNeeded();
  const massing = page.locator('[data-scene-host="massing"] canvas');
  const units = page.locator('[data-scene-host="units"] canvas');
  await expect(massing).toBeVisible();
  await expect(page).toHaveTitle("SYNTHETIC native server title | Investment Experts");
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.drawsByHost.massing ?? 0)).toBeGreaterThan(0);
  expect(await massing.evaluate((canvas) => {
    const extension = (canvas as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context");
    extension?.loseContext();
    return Boolean(extension);
  })).toBe(true);
  await expect(massing).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="twin-massing-heading"] svg[viewBox="0 0 320 180"]')).toBeVisible();
  await page.locator("#twin-explorer-heading").scrollIntoViewIfNeeded();
  await expect(units).toBeVisible();
  await units.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.drawsByHost.units ?? 0)).toBeGreaterThan(0);
  expect(await units.evaluate((canvas) => {
    const extension = (canvas as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context");
    extension?.loseContext();
    return Boolean(extension);
  })).toBe(true);
  await expect(units).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="twin-explorer-heading"] table')).toBeVisible();
  expect(await page.evaluate(() => window.__sceneAudit.releasesByHost.massing)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__sceneAudit.releasesByHost.units)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  } finally {
    // Exact owned IDs only; no jobs/outbox were created or replayed.
    await db.seoMetadata.deleteMany({ where: { routeKey: `projects/${fixtureId}` } });
    await db.project.deleteMany({ where: { id: fixtureId } });
    await db.developer.deleteMany({ where: { id: fixtureId } });
    await db.community.deleteMany({ where: { id: fixtureId } });
  }
});

test("real Atlas WebGL context loss uses 2D fallback and unavailable tiles remain honest", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await atlasFixture(page);
  await instrumentRenderer(page);
  await page.goto("/atlas?mode=3d");
  const canvas = page.locator('[data-scene-host="atlas"] canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__sceneAudit.draws)).toBeGreaterThan(5);
  const supported = await canvas.evaluate((element) => {
    const extension = (element as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect(canvas).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "2D map", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".leaflet-container")).toHaveCount(1);
  await expect(page.getByText(/^Map tiles unavailable —/)).toBeVisible();
  expect(errors).toEqual([]);
});

for (const locale of ["en", "ar"] as const) {
  test(`${locale} missing WebGL2 falls back without loading a scene`, async ({ page }) => {
    await atlasFixture(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        value: function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
          if (args[0] === "webgl2") return null;
          return Reflect.apply(original, this, args);
        },
      });
    });
    await page.goto(`${locale === "ar" ? "/ar" : ""}/atlas?mode=3d`);
    await expect(page.locator(".leaflet-container")).toHaveCount(1);
    await expect(page.locator("[data-scene-host]")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: locale === "ar" ? "عرض 3D" : "3D view", exact: true })).toBeDisabled();
    await expect(page.getByRole("tab", { name: locale === "ar" ? "خريطة 2D" : "2D map", exact: true })).toHaveAttribute("aria-selected", "true");
  });
}

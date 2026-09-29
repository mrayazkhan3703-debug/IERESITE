import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const runId = `${Date.now()}-${randomBytes(6).toString("hex")}`;
const slug = `iere-property-studio-${runId}`;
const propertyRouteKey = `properties/${slug}`;
const seoTitle = `Synthetic SEO title ${runId}`;
const seoDescription = `Synthetic SEO description ${runId}`;
const userId = `iere-property-studio-user-${runId}`;
const email = `iere-property-studio-${runId}@example.invalid`;
const sessionToken = randomBytes(32).toString("hex");
const communityId = `iere-property-studio-community-${runId}`;
const developerId = `iere-property-studio-developer-${runId}`;
const amenityId = `iere-property-studio-amenity-${runId}`;
const agentId = `iere-property-studio-agent-${runId}`;
const mediaIds: string[] = [];
const title = `Synthetic Property Studio ${runId}`;

async function cleanup() {
  await db.seoMetadata.deleteMany({ where: { routeKey: propertyRouteKey } });
  const property = await db.property.findUnique({ where: { slug }, select: { id: true } });
  if (property) {
    await db.auditLog.deleteMany({ where: { resourceId: property.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: property.id } });
    await db.property.delete({ where: { id: property.id } });
  }
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.amenity.deleteMany({ where: { id: amenityId } });
  await db.agent.deleteMany({ where: { id: agentId } });
  if (mediaIds.length) await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
  await db.community.deleteMany({ where: { id: communityId } });
  await db.developer.deleteMany({ where: { id: developerId } });
}

test.beforeAll(async () => {
  await cleanup();
  const owner = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: userId, email, emailVerified: new Date(), name: "Synthetic Property Studio Owner", roles: { create: { roleId: owner.id } } } });
  await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(sessionToken).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60 * 1000), mfaVerifiedAt: new Date() } });
  await db.developer.create({ data: { id: developerId, name: "Synthetic Property Studio Developer", slug: `${slug}-developer` } });
  await db.community.create({ data: { id: communityId, name: "Synthetic Property Studio Community", slug: `${slug}-community`, areaType: "RESIDENTIAL", lat: 25.1, lng: 55.1, publicationStatus: "PUBLISHED" } });
  await db.amenity.create({ data: { id: amenityId, key: `${slug}-POOL`, name: "Synthetic Pool", category: "BUILDING" } });
  await db.agent.create({ data: { id: agentId, name: "Synthetic Property Studio Advisor", slug: `${slug}-advisor`, active: true, publicAdvisor: false } });
});

test.afterAll(async () => { await cleanup(); await db.$disconnect(); });

test("owner creates a property draft, edits rich facts, then publishes a ready listing", async ({ page }) => {
  test.setTimeout(240_000);
  const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const mediaErrors: string[] = [];
  page.on("pageerror", (error) => mediaErrors.push(error.message));

  await page.goto("/admin/media");
  const imageBytes = readFileSync(resolve(process.cwd(), "public/images/properties/apartment-marina-living.jpg"));
  const floorPlanBytes = readFileSync(resolve(process.cwd(), "public/images/brand/floorplan-sample.jpg"));
  await page.getByLabel(/Drop files here or choose multiple/).setInputFiles([
    { name: "property-gallery.jpg", mimeType: "image/jpeg", buffer: imageBytes },
    { name: "property-floor-plan.jpg", mimeType: "image/jpeg", buffer: floorPlanBytes },
  ]);
  const uploadResponses: import("@playwright/test").Response[] = [];
  const captureUpload = (response: import("@playwright/test").Response) => {
    if (new URL(response.url()).pathname === "/api/media" && response.request().method() === "POST") uploadResponses.push(response);
  };
  page.on("response", captureUpload);
  await page.getByRole("button", { name: "Upload 2 assets" }).click();
  await expect.poll(() => uploadResponses.length, { timeout: 30_000 }).toBe(2);
  page.off("response", captureUpload);
  for (const response of uploadResponses) {
    expect(response.status()).toBe(201);
    mediaIds.push(String((await response.json()).id));
  }
  await expect(page.getByText("File: property-gallery.jpg", { exact: true })).toBeVisible();
  await expect(page.getByText("File: property-floor-plan.jpg", { exact: true })).toBeVisible();

  await page.goto("/admin/properties");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("button", { name: "Create property" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("URL slug", { exact: true }).fill(slug);
  await dialog.getByLabel("Latitude", { exact: true }).fill("25.1");
  await dialog.getByLabel("Longitude", { exact: true }).fill("55.1");
  await dialog.getByLabel("Price (AED)").fill("2500000");
  await dialog.getByLabel("Listing type").click();
  await page.getByRole("option", { name: "SALE", exact: true }).click();
  await dialog.getByLabel("Listing availability").click();
  await page.getByRole("option", { name: "AVAILABLE", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Community", exact: true }).click();
  await page.getByRole("option", { name: /Synthetic Property Studio Community/ }).click();
  await dialog.getByRole("combobox", { name: "Listing advisor", exact: true }).click();
  await page.getByRole("option", { name: "Synthetic Property Studio Advisor", exact: true }).click();
  await dialog.getByRole("group", { name: "Amenities" }).getByText("Synthetic Pool", { exact: true }).click();
  await dialog.getByRole("combobox", { name: "Public property cover image", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(mediaIds[0]!.slice(0, 18)) }).click();
  const createResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create draft property" }).click();
  const created = await createResponse;
  expect(created.status()).toBe(201);
  const createdProperty = await created.json() as { id: string };

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText("DRAFT");
  await row.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("dialog");
  const galleryPicker = editor.getByRole("combobox", { name: "Select a gallery image", exact: true });
  await galleryPicker.click();
  await page.getByRole("option", { name: new RegExp(mediaIds[1]!.slice(0, 18)) }).click();
  const galleryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/media/gallery" && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Add image", exact: true }).click();
  expect((await galleryResponse).status()).toBe(201);
  await editor.getByRole("combobox", { name: "Select floor plan", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(mediaIds[1]!.slice(0, 18)) }).click();
  await editor.getByLabel("Floor plan label").fill("Type A floor plan");
  await editor.getByLabel("Floor plan bedrooms").fill("2");
  await editor.getByLabel("Floor plan area").fill("1325");
  const floorPlanResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties/media" && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Add floor plan", exact: true }).click();
  expect((await floorPlanResponse).status()).toBe(201);
  const previewPromise = page.context().waitForEvent("page");
  await editor.getByRole("link", { name: "Preview saved record" }).click();
  const preview = await previewPromise;
  await expect(preview).toHaveURL(new RegExp(`/admin/properties/${slug}/preview$`));
  await expect(preview.getByText("Private draft preview.", { exact: false })).toBeVisible();
  await expect(preview.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(preview.getByText("Type A floor plan", { exact: false })).toBeVisible();
  await preview.close();
  await editor.getByLabel("Short description").fill("A verified waterfront residence.");
  await editor.getByLabel("Built-up area (sq ft)").fill("1325");
  await editor.getByLabel("RERA permit").fill("SYNTHETIC-RERA-001");
  await editor.getByLabel("Highlights").fill("Waterfront\nBalcony");
  await expect(editor.getByRole("group", { name: "Amenities" }).getByLabel("Synthetic Pool")).toBeChecked();
  await editor.getByLabel("Price (AED)").fill("2600000");
  await editor.getByLabel("Publication status").click();
  await page.getByRole("option", { name: "PUBLISHED", exact: true }).click();
  const updateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties" && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "Save changes" }).click();
  expect((await updateResponse).status()).toBe(200);

  const stored = await db.property.findUniqueOrThrow({ where: { slug }, include: { listings: { include: { priceHistory: true } }, amenities: true, media: true, floorPlans: true } });
  expect(stored).toMatchObject({ publicationStatus: "PUBLISHED", shortDescription: "A verified waterfront residence.", builtUpAreaSqft: 1325, reraPermit: "SYNTHETIC-RERA-001" });
  expect(JSON.parse(stored.highlightsJson ?? "[]")).toEqual(["Waterfront", "Balcony"]);
  expect(stored.amenities.map((item) => item.amenityId)).toContain(amenityId);
  expect(stored.media.map((item) => item.mediaId)).toEqual(expect.arrayContaining(mediaIds));
  expect(stored.floorPlans.map((item) => item.mediaId)).toContain(mediaIds[1]);
  expect(stored.listings[0]?.agentId).toBe(agentId);
  expect(stored.listings[0]?.publishedAt).not.toBeNull();
  expect(stored.listings[0]?.priceMinor).toBe(260_000_000n);
  expect(stored.listings[0]?.priceHistory).toHaveLength(2);
  expect(await db.auditLog.count({ where: { resourceId: stored.id, action: "property.publish" } })).toBe(1);
  await expect(page.getByRole("row").filter({ hasText: title })).toContainText("PUBLISHED");

  const usedResponse = await page.request.get(`/api/media?q=${encodeURIComponent("property-floor-plan.jpg")}`);
  expect(usedResponse.status()).toBe(200);
  const usedResult = await usedResponse.json() as { media: { id: string; usageCount: number; usageGraph: { type: string; label: string }[] }[] };
  const floorAsset = usedResult.media.find((asset) => asset.id === mediaIds[1]);
  expect(floorAsset?.usageCount).toBeGreaterThanOrEqual(2);
  expect(floorAsset?.usageGraph.map((use) => use.type)).toEqual(expect.arrayContaining(["PROPERTY_GALLERY", "PROPERTY_FLOOR_PLAN"]));
  const blockedDelete = await page.request.delete("/api/media", { headers: { "x-requested-with": "fetch" }, data: { mediaAssetIds: [mediaIds[1]] } });
  expect(blockedDelete.status()).toBe(207);
  expect((await blockedDelete.json()).blocked).toBe(1);

  await page.goto(`/admin/seo-metadata?q=${encodeURIComponent(propertyRouteKey)}`);
  await expect(page.getByLabel("Search SEO metadata")).toHaveValue(propertyRouteKey);
  await page.getByRole("button", { name: "Add route metadata" }).click();
  const seoDialog = page.getByRole("dialog");
  await expect(seoDialog.getByLabel("Route key")).toHaveValue(propertyRouteKey);
  await seoDialog.getByLabel("Title override (optional)").fill(seoTitle);
  await seoDialog.getByLabel("Description override (optional)").fill(seoDescription);
  await seoDialog.getByRole("combobox", { name: "Public Open Graph image", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(mediaIds[0]!.slice(0, 18)) }).click();
  const seoResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/seo-metadata" && response.request().method() === "POST");
  await seoDialog.getByRole("button", { name: "Create route metadata" }).click();
  expect((await seoResponse).status()).toBe(201);

  await page.goto(`/properties/${slug}`);
  await expect(page).toHaveTitle(new RegExp(seoTitle));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", seoDescription);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/api/media/${mediaIds[0]}/content`));
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Type A floor plan", { exact: false })).toBeVisible();
  await page.goto(`/ar/properties/${slug}`);
  await expect(page).toHaveTitle(new RegExp(seoTitle));
  await expect.poll(async () => {
    const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
    const result = await response.json() as { results: { slug: string }[] };
    return result.results.some((item) => item.slug === slug);
  }, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/map?zoom=6&q=${encodeURIComponent(title)}`);
    const result = await response.json() as { results: { slug: string }[] };
    return result.results.some((item) => item.slug === slug);
  }, { timeout: 30_000 }).toBe(true);

  await page.goto("/admin/properties");
  const publishedRow = page.getByRole("row").filter({ hasText: title });
  await publishedRow.getByRole("button", { name: "Edit" }).click();
  const publishedEditor = page.getByRole("dialog");
  await publishedEditor.getByLabel("Publication status").click();
  await page.getByRole("option", { name: "UNPUBLISHED", exact: true }).click();
  const unpublishResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties" && response.request().method() === "PATCH");
  await publishedEditor.getByRole("button", { name: "Save changes" }).click();
  expect((await unpublishResponse).status()).toBe(200);
  const unpublished = await db.property.findUniqueOrThrow({ where: { id: createdProperty.id } });
  expect(unpublished.publicationStatus).toBe("UNPUBLISHED");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/search?q=${encodeURIComponent(title)}`);
    const result = await response.json() as { results: { slug: string }[] };
    return result.results.some((item) => item.slug === slug);
  }, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/map?zoom=6&q=${encodeURIComponent(title)}`);
    const result = await response.json() as { results: { slug: string }[] };
    return result.results.some((item) => item.slug === slug);
  }, { timeout: 30_000 }).toBe(false);
  expect((await page.request.get(`/api/properties/${slug}`)).status()).toBe(404);
  expect(mediaErrors).toEqual([]);
});

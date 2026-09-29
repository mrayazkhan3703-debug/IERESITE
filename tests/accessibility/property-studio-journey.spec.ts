import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const runId = `${Date.now()}-${randomBytes(6).toString("hex")}`;
const slug = `iere-property-studio-${runId}`;
const userId = `iere-property-studio-user-${runId}`;
const email = `iere-property-studio-${runId}@example.invalid`;
const sessionToken = randomBytes(32).toString("hex");
const communityId = `iere-property-studio-community-${runId}`;
const developerId = `iere-property-studio-developer-${runId}`;
const amenityId = `iere-property-studio-amenity-${runId}`;

async function cleanup() {
  const property = await db.property.findUnique({ where: { slug }, select: { id: true } });
  if (property) {
    await db.auditLog.deleteMany({ where: { resourceId: property.id } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: property.id } });
    await db.property.delete({ where: { id: property.id } });
  }
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.amenity.deleteMany({ where: { id: amenityId } });
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
});

test.afterAll(async () => { await cleanup(); await db.$disconnect(); });

test("owner creates a property draft, edits rich facts, then publishes a ready listing", async ({ page }) => {
  test.setTimeout(120_000);
  const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/admin/properties");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("button", { name: "Create property" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Synthetic Property Studio Listing");
  await dialog.getByLabel("URL slug", { exact: true }).fill(slug);
  await dialog.getByLabel("Latitude", { exact: true }).fill("25.1");
  await dialog.getByLabel("Longitude", { exact: true }).fill("55.1");
  await dialog.getByLabel("Price (AED)").fill("2500000");
  await dialog.getByLabel("Listing type").click();
  await page.getByRole("option", { name: "SALE" }).click();
  await dialog.getByLabel("Listing availability").click();
  await page.getByRole("option", { name: "AVAILABLE" }).click();
  await dialog.getByRole("combobox", { name: "Community", exact: true }).click();
  await page.getByRole("option", { name: /Synthetic Property Studio Community/ }).click();
  const createResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create draft property" }).click();
  expect((await createResponse).status()).toBe(201);

  const row = page.getByRole("row").filter({ hasText: "Synthetic Property Studio Listing" });
  await expect(row).toContainText("DRAFT");
  await row.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Short description").fill("A verified waterfront residence.");
  await editor.getByLabel("Built-up area (sq ft)").fill("1325");
  await editor.getByLabel("RERA permit").fill("SYNTHETIC-RERA-001");
  await editor.getByLabel("Highlights").fill("Waterfront\nBalcony");
  await editor.getByRole("group", { name: "Amenities" }).getByText("Synthetic Pool").click();
  await editor.getByLabel("Publication status").click();
  await page.getByRole("option", { name: "PUBLISHED" }).click();
  const updateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/properties" && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "Save changes" }).click();
  expect((await updateResponse).status()).toBe(200);

  const stored = await db.property.findUniqueOrThrow({ where: { slug }, include: { listings: true, amenities: true } });
  expect(stored).toMatchObject({ publicationStatus: "PUBLISHED", shortDescription: "A verified waterfront residence.", builtUpAreaSqft: 1325, reraPermit: "SYNTHETIC-RERA-001" });
  expect(JSON.parse(stored.highlightsJson ?? "[]")).toEqual(["Waterfront", "Balcony"]);
  expect(stored.amenities.map((item) => item.amenityId)).toContain(amenityId);
  expect(stored.listings[0]?.publishedAt).not.toBeNull();
  expect(stored.listings[0]?.priceMinor).toBe(250_000_000n);
  expect(await db.auditLog.count({ where: { resourceId: stored.id, action: "property.publish" } })).toBe(1);
  await expect(page.getByRole("row").filter({ hasText: "Synthetic Property Studio Listing" })).toContainText("PUBLISHED");
});

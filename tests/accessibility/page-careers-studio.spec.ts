import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const prefix = `iere-page-careers-${Date.now()}-${randomBytes(4).toString("hex")}`;
const ownerId = `${prefix}-owner`;
const reviewerId = `${prefix}-reviewer`;
const ownerToken = randomBytes(32).toString("hex");
const reviewerToken = randomBytes(32).toString("hex");
let ownsSettings = false;
const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";

test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1", "web-test", "web"].includes(new URL(baseURL).hostname) || !["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Studio browser fixtures require the disposable local stack.");
  if (await db.siteSetting.count()) throw new Error("Studio settings fixture requires an empty settings table.");
  ownsSettings = true;
  for (const [id, token, roleKey] of [[ownerId, ownerToken, "OWNER"], [reviewerId, reviewerToken, "ADMIN"]]) {
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    await db.user.create({ data: { id, email: `${id}@example.invalid`, emailVerified: new Date(), name: "Synthetic studio account", roles: { create: { roleId: role.id } } } });
    await db.session.create({ data: { userId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
  }
});
test.afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorId: { in: [ownerId, reviewerId] } } });
  await db.careerOpening.deleteMany({ where: { slug: { startsWith: prefix } } });
  if (ownsSettings) await db.siteSetting.deleteMany({ where: { id: "public" } });
  await db.session.deleteMany({ where: { userId: { in: [ownerId, reviewerId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, reviewerId] } } });
  await db.$disconnect();
});

test("owner customizes navigation and bilingual core-page copy through form fields", async ({ page }) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: ownerToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/admin/site-settings");
  await expect(page.getByRole("heading", { name: "Site settings", exact: true })).toBeVisible();
  await page.getByLabel("English label", { exact: true }).first().fill("Synthetic navigation");
  await page.getByLabel("Arabic label", { exact: true }).first().fill("تصفح اختباري");
  const copy = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: "Careers · heading", exact: true }) }).first();
  await copy.getByLabel("English", { exact: true }).fill("Synthetic careers page");
  await copy.getByLabel("Arabic", { exact: true }).fill("وظائف اختبارية");
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/admin/site-settings" && value.request().method() === "PUT");
  await page.getByRole("button", { name: "Save site settings", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Save site settings", exact: true })).toBeEnabled();
  const saved = await db.siteSetting.findUniqueOrThrow({ where: { id: "public" } });
  expect(JSON.parse(saved.settingsJson).headerGroups[0].labelEn).toBe("Synthetic navigation");
  expect(await db.siteSettingRevision.count({ where: { siteSettingId: "public" } })).toBe(1);
  await page.goto("/careers");
  await expect(page.getByRole("heading", { name: "Synthetic careers page", exact: true })).toBeVisible();
  await page.goto("/ar/careers");
  await expect(page.getByRole("heading", { name: "وظائف اختبارية", exact: true })).toBeVisible();
});

test("a career draft remains private until a different reviewer approves and publishes it", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: ownerToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/admin/careers");
  await page.getByRole("button", { name: "Add opening", exact: true }).click();
  const title = `Synthetic role ${prefix}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("URL slug", { exact: true }).fill(prefix);
  await page.getByLabel("Department", { exact: true }).fill("Synthetic team");
  await page.getByLabel("Location", { exact: true }).fill("Synthetic office");
  await page.getByLabel("Summary", { exact: true }).fill("Synthetic local browser fixture only.");
  await page.getByLabel("Description", { exact: true }).fill("Synthetic role body.");
  await page.getByLabel(/^requirements/i).fill("Synthetic qualification required.");
  await page.getByLabel("Application method", { exact: true }).selectOption("URL");
  await page.getByLabel("Application destination", { exact: true }).fill("https://example.invalid/apply");
  await page.getByLabel("SEO title (optional)", { exact: true }).fill("Synthetic role search title");
  const createdResponse = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/admin/careers" && value.request().method() === "POST");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await createdResponse).status()).toBe(201);
  const role = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(role).toContainText("DRAFT");
  expect((await page.request.get(`/api/careers/openings/${prefix}`)).status()).toBe(404);
  await role.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(role.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: reviewerToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.reload();
  await role.getByRole("button", { name: "Approve", exact: true }).click();
  await role.getByRole("button", { name: "Publish approved opening", exact: true }).click();
  await expect(role).toContainText("PUBLISHED");
  await page.goto(`/careers/${prefix}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic qualification required.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Apply for this role", exact: true })).toHaveAttribute("href", "https://example.invalid/apply");
  await expect(page).toHaveTitle(/Synthetic role search title/);
  expect(errors).toEqual([]);
});

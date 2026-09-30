import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import type { Page, Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const db = new PrismaClient();
const prefix = `inline-forms-${Date.now()}-${randomBytes(4).toString("hex")}`;
const ownerId = prefix + "-owner", token = randomBytes(32).toString("hex");
const baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
const mediaIds: string[] = [], entityIds: string[] = [], actorIds: string[] = [ownerId];
let ownsSettings = false, sequence = 0;

test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1", "web", "web-test"].includes(new URL(baseURL).hostname) || !["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Inline form journeys require disposable local services.");
  if (await db.siteSetting.count()) throw new Error("Inline settings journeys require an empty settings table.");
  ownsSettings = true;
  const role = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: ownerId, email: ownerId + "@example.invalid", emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
  await db.session.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
});

test.afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorId: ownerId } });
  await db.seoMetadata.deleteMany({ where: { routeKey: { contains: prefix } } });
  await db.contentEntry.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.marketReport.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.property.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.project.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.agent.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.community.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.developer.deleteMany({ where: { slug: { startsWith: prefix } } });
  if (ownsSettings) await db.siteSetting.deleteMany({ where: { id: "public" } });
  await db.session.deleteMany({ where: { userId: { in: actorIds } } });
  await db.user.deleteMany({ where: { id: { in: actorIds } } });
  await db.outboxEvent.deleteMany({ where: { OR: [{ aggregateId: { in: mediaIds } }, { aggregateId: { in: entityIds } }] } });
  // Storage objects remain in the disposable CI bucket until container teardown.
  await db.mediaProcessingJob.deleteMany({ where: { mediaId: { in: mediaIds } } });
  await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
  await db.$disconnect();
});

async function upload(page: Page, field: Locator, filename: string) {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: (++sequence * 7) % 255, g: (sequence * 19) % 255, b: (sequence * 23) % 255 } } }).png().toBuffer();
  await field.getByRole("button", { name: "Upload New", exact: true }).click();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/media" && r.request().method() === "POST");
  await field.getByLabel("Upload new media").setInputFiles({ name: filename, mimeType: "image/png", buffer: bytes });
  const uploaded = await response;
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const asset = await uploaded.json() as { id: string; url: string };
  mediaIds.push(asset.id);
  await expect(field.getByText(filename + " · done", { exact: true })).toBeVisible();
  await expect(field.locator("img")).toHaveAttribute("src", asset.url);
  expect((await page.request.get(asset.url)).status()).toBe(200);
  expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  return asset;
}
async function choose(page: Page, field: Locator, filename: string) {
  await field.getByRole("button", { name: "Choose Existing", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Choose existing media", exact: true });
  await library.getByLabel("Search Media Library").fill(filename);
  await library.getByRole("button", { name: filename, exact: true }).click();
  await expect(library).toHaveCount(0);
}
async function save(page: Page, scope: Locator, button: string, endpoint: string, method: string) {
  const pending = page.waitForResponse((r) => new URL(r.url()).pathname === endpoint && r.request().method() === method);
  await scope.getByRole("button", { name: button, exact: true }).click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(method === "POST" ? 201 : 200);
  const result = await response.json(); if (result.id) entityIds.push(result.id); return result;
}
async function select(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}

test("inline uploads retry interruption, reuse duplicates, cancel and retain library assets after discard", async ({ page }) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/admin/content"); await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const field = page.getByRole("dialog").getByRole("group", { name: "Cover image", exact: true });
  await field.getByRole("button", { name: "Upload New", exact: true }).click();
  let interrupt = true;
  await page.route("**/api/media", async (route) => {
    if (route.request().method() === "POST" && interrupt) { interrupt = false; await route.abort("connectionreset"); }
    else await route.continue();
  });
  const bytes = await sharp({ create: { width: 27, height: 19, channels: 3, background: { r: 14, g: 17, b: 18 } } }).png().toBuffer();
  const file = { name: prefix + "-retry.png", mimeType: "image/png", buffer: bytes };
  await field.getByLabel("Upload new media").setInputFiles(file);
  await expect(field.getByText("Connection interrupted. Retry this upload.", { exact: true })).toBeVisible();
  const retried = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/media" && r.request().method() === "POST");
  await field.getByRole("button", { name: "Retry", exact: true }).click();
  const response = await retried; expect(response.status()).toBe(201); const asset = await response.json(); mediaIds.push(asset.id);
  await expect(field.getByText(file.name + " · done", { exact: true })).toBeVisible();
  const duplicate = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/media" && r.request().method() === "POST");
  await field.getByLabel("Upload new media").setInputFiles(file); expect((await duplicate).status()).toBe(409);
  await field.getByRole("button", { name: "Use existing asset", exact: true }).click();
  await expect(field.locator("img")).toHaveAttribute("src", asset.url);
  await page.unroute("**/api/media");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/media", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await hold; await route.abort().catch(() => {});
  });
  await field.getByLabel("Upload new media").setInputFiles({ ...file, name: prefix + "-cancel.png" });
  await field.getByRole("button", { name: "Cancel upload", exact: true }).click();
  await expect(field.getByText("Upload cancelled.", { exact: true })).toBeVisible(); release();
  await page.unroute("**/api/media");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  expect(await db.contentEntry.count({ where: { coverMediaId: asset.id } })).toBe(0);
});

for (const locale of ["en", "ar"] as const) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`${locale} ${size}: inline upload and reuse survive create, edit and reload across CMS modules`, async ({ page }) => {
    test.setTimeout(360000);
    await page.setViewportSize(viewport);
    await page.context().addCookies([{ name: process.env.AUTH_COOKIE_NAME ?? "ie_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const suffix = `${locale}-${size}`, root = locale === "ar" ? "/ar" : "";
    let developerId = "", communityId = "";
    const modules = [
      { section: "developers", create: "Create developer", submit: "Create unverified developer", label: "Public developer logo",  },
      { section: "communities", create: "Create community", submit: "Create draft community", label: "Public community cover image",  },
      { section: "projects", create: "Create project", submit: "Create draft project", label: "Public project brochure or image",  },
      { section: "properties", create: "Create property", submit: "Create draft property", label: "Cover image",  },
      { section: "agents", create: "New team profile", submit: "Create inactive profile", label: "Public team profile photo",  },
    ];
    for (const entityModule of modules) {
      const slug = `${prefix}-${suffix}-${entityModule.section}`, name = `Synthetic media ${suffix} ${entityModule.section}`;
      if (entityModule.section === "agents") {
        const id = slug + "-account"; actorIds.push(id);
        const role = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
        await db.user.create({ data: { id, email: id + "@example.invalid", name, emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
      }
      await page.goto(`${root}/admin/${entityModule.section}`);
      await page.getByRole("button", { name: entityModule.create, exact: true }).click();
      const editor = page.getByRole("dialog");
      await editor.getByLabel(entityModule.section === "properties" ? "Title" : "Name", { exact: true }).fill(name);
      await editor.getByLabel("URL slug", { exact: true }).fill(slug);
      if (["projects", "properties", "communities"].includes(entityModule.section)) {
        await editor.getByLabel("Latitude", { exact: true }).fill("25"); await editor.getByLabel("Longitude", { exact: true }).fill("55");
      }
      if (["projects", "properties"].includes(entityModule.section)) {
        await select(page, editor, "Community", new RegExp(`Synthetic media ${suffix} communities`));
        if (entityModule.section === "projects") await select(page, editor, "Developer", new RegExp(`Synthetic media ${suffix} developers`));
        else { await editor.getByLabel("Price (AED)").fill("100"); await select(page, editor, "Listing type", "SALE"); }
      }
      if (entityModule.section === "agents") {
        await select(page, editor, "Active, verified AGENT account", new RegExp(name));
        await editor.getByLabel("Job title", { exact: true }).fill("Synthetic test advisor");
      }
      const filename = slug + ".png", field = editor.getByRole("group", { name: entityModule.label, exact: true });
      const asset = await upload(page, field, filename);
      if (entityModule.section === "projects") await choose(page, editor.getByRole("region", { name: "Gallery", exact: true }), filename);
      const created = await save(page, editor, entityModule.submit, "/api/admin/" + entityModule.section, "POST") as { id: string };
      expect(created.id).toBeTruthy();
      if (entityModule.section === "developers") developerId = created.id;
      if (entityModule.section === "communities") communityId = created.id;
      const row = page.getByRole("row").filter({ hasText: name });
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      const editField = page.getByRole("dialog").getByRole("group", { name: entityModule.label, exact: true });
      await expect(editField.locator("img")).toHaveAttribute("src", asset.url);
      await expect(editField.getByRole("button", { name: "Replace / Upload New", exact: true })).toBeVisible();
      await editField.getByRole("button", { name: "Remove", exact: true }).click();
      await choose(page, editField, filename);
      await save(page, page.getByRole("dialog"), "Save changes", "/api/admin/" + entityModule.section, "PATCH");
      await page.reload();
      await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("group", { name: entityModule.label, exact: true }).locator("img")).toHaveAttribute("src", asset.url);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
    }
    expect(developerId && communityId).toBeTruthy();
    for (const contentType of ["PAGE", "INTERNATIONAL_GUIDE"] as const) {
      const slug = `${prefix}-${suffix}-${contentType.toLowerCase().replaceAll("_", "-")}`, title = `Synthetic ${contentType} ${suffix}`;
      await page.goto(`${root}/admin/content`);
      await page.getByRole("button", { name: "Create draft", exact: true }).click();
      const editor = page.getByRole("dialog");
      await select(page, editor, "Content type", contentType.replaceAll("_", " "));
      await select(page, editor, "Locale", locale === "ar" ? "Arabic" : "English");
      await editor.getByLabel("Title", { exact: true }).fill(title); await editor.getByLabel("Slug", { exact: true }).fill(slug);
      const filename = slug + ".png", asset = await upload(page, editor.getByRole("group", { name: "Cover image", exact: true }), filename);
      await editor.getByRole("button", { name: "Visual blocks", exact: true }).click();
      await editor.getByRole("button", { name: "Add image", exact: true }).click();
      await choose(page, editor.getByRole("group", { name: "Content block image", exact: true }), filename);
      await editor.getByLabel("Alternative text", { exact: true }).fill(locale === "ar" ? "صورة اختبارية" : "Synthetic test image");
      await save(page, editor, "Create draft", "/api/admin/content", "POST");
      const entry = await db.contentEntry.findUniqueOrThrow({ where: { slug } });
      expect(entry.coverMediaId).toBe(asset.id); expect(entry.bodyJson).toContain(asset.id); expect(entry.status).toBe("DRAFT");
      await page.getByRole("row").filter({ hasText: title }).getByRole("button", { name: "Edit", exact: true }).click();
      await choose(page, page.getByRole("dialog").getByRole("group", { name: "Cover image", exact: true }), filename);
      await save(page, page.getByRole("dialog"), "Save revision", "/api/admin/content", "PATCH");
      await page.reload(); expect((await db.contentEntry.findUniqueOrThrow({ where: { slug } })).coverMediaId).toBe(asset.id);
    }
    const reportSlug = `${prefix}-${suffix}-report`, reportTitle = `Synthetic report ${suffix}`;
    await page.goto(`${root}/admin/market-reports`); await page.getByRole("button", { name: "New report", exact: true }).click();
    const report = page.getByRole("dialog"); await report.getByLabel("Title", { exact: true }).fill(reportTitle); await report.getByLabel("URL slug", { exact: true }).fill(reportSlug);
    const reportFilename = reportSlug + ".png", cover = await upload(page, report.getByRole("group", { name: "Report cover image", exact: true }), reportFilename);
    const pdfField = report.getByRole("group", { name: "Report PDF", exact: true }); await pdfField.getByRole("button", { name: "Upload New", exact: true }).click();
    const pdfUpload = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/media" && r.request().method() === "POST");
    await pdfField.getByLabel("Upload new media").setInputFiles({ name: reportSlug + ".pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% Synthetic unpublished verification ${reportSlug}\n%%EOF\n`) });
    const pdfResponse = await pdfUpload; expect(pdfResponse.status()).toBe(201); const pdf = await pdfResponse.json(); mediaIds.push(pdf.id);
    await expect(pdfField.getByText(reportSlug + ".pdf · done", { exact: true })).toBeVisible();
    await save(page, report, "Save draft", "/api/admin/market-reports", "POST");
    await page.getByRole("row").filter({ hasText: reportTitle }).getByRole("button", { name: "Edit", exact: true }).click();
    await choose(page, page.getByRole("dialog").getByRole("group", { name: "Report cover image", exact: true }), reportFilename);
    await save(page, page.getByRole("dialog"), "Save draft", "/api/admin/market-reports", "PATCH");
    expect((await db.marketReport.findUniqueOrThrow({ where: { slug: reportSlug } })).fileMediaId).toBe(pdf.id);
    const publicDownload = await page.context().request.get(cover.url); expect(publicDownload.status()).toBe(200);
    await page.goto(`${root}/admin/seo-metadata`); await page.getByRole("button", { name: "Add route metadata", exact: true }).click();
    const seo = page.getByRole("dialog"); await seo.getByLabel("Route key", { exact: true }).fill("pages/" + `${prefix}-${suffix}-page`);
    await choose(page, seo.getByRole("group", { name: "Open Graph image", exact: true }), reportFilename);
    await save(page, seo, "Create route metadata", "/api/admin/seo-metadata", "POST");
    await page.getByRole("row").filter({ hasText: "pages/" + `${prefix}-${suffix}-page` }).getByRole("button", { name: "Edit", exact: true }).click();
    await choose(page, page.getByRole("dialog").getByRole("group", { name: "Open Graph image", exact: true }), reportFilename);
    await save(page, page.getByRole("dialog"), "Save changes", "/api/admin/seo-metadata", "PATCH");
    await page.goto(`${root}/admin/site-settings`);
    for (const label of ["Default social preview image", "Fallback image"]) await choose(page, page.getByRole("group", { name: label, exact: true }), reportFilename);
    await save(page, page.locator("form"), "Save site settings", "/api/admin/site-settings", "PUT");
    await page.reload(); await expect(page.getByRole("group", { name: "Fallback image", exact: true }).locator("img")).toHaveAttribute("src", cover.url);
    const accessibility = await new AxeBuilder({ page }).include('[role="group"][aria-label="Fallback image"]').analyze();
    expect(accessibility.violations).toEqual([]); expect(errors).toEqual([]);
  });
}

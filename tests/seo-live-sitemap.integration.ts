import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { canonicalSitemapEntries, sitemapXml } from "@/server/seo/sitemap";
import { resolveSpaRoutePage, spaRouteMetadata } from "@/server/seo/route-contract";
import { createSeoMetadataCommand } from "@/server/domain/seo-metadata-command";
import type { SessionUser } from "@/server/auth";
const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
if (!["web", "web-test", "localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname) || !["postgres", "db", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Sitemap verification requires disposable local services.");
const prefix = "sitemap-live-" + randomUUID(), group = prefix + "-group", userId = prefix + "-owner";
const enSlug = prefix + "-en", arSlug = prefix + "-ar", enPath = `/guides/${enSlug}`, arPath = `/ar/guides/${arSlug}`;
const actor: SessionUser = { id: userId, sessionId: prefix, email: userId + "@example.invalid", name: "Local verifier", organizationId: null, roles: ["OWNER"], permissions: ["seo:update"], mfaVerified: true };
beforeAll(async () => {
  await db.user.create({ data: { id: userId, email: actor.email } });
  await db.contentTranslationGroup.create({ data: { id: group } });
  await db.contentEntry.createMany({ data: [
    { slug: enSlug, title: "Disposable reviewed English guide", contentType: "GUIDE", locale: "en", status: "PUBLISHED", translationGroupId: group, publishedAt: new Date(Date.now() - 60000) },
    { slug: arSlug, title: "دليل اختباري", contentType: "GUIDE", locale: "ar", status: "PUBLISHED", translationGroupId: group, publishedAt: new Date(Date.now() - 60000) },
    { slug: prefix + "-scheduled", title: "Scheduled local fixture", contentType: "PAGE", locale: "ar", status: "PUBLISHED", publishedAt: new Date(Date.now() + 86400000) },
    { slug: prefix + "-expired", title: "Expired verification source", contentType: "INTERNATIONAL_GUIDE", locale: "ar", status: "PUBLISHED", publishedAt: new Date(Date.now() - 60000), sourceName: "Local fixture", sourceUrl: "https://example.invalid", sourceVerifiedAt: new Date(Date.now() - 60000), freshnessReviewDueAt: new Date(Date.now() - 60000) },
  ] });
  await db.sitemapEntry.create({ data: { section: "guides", path: `/guides/${prefix}-stale` } });
});
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.seoMetadata.deleteMany({ where: { routeKey: { contains: prefix } } });
  await db.redirect.deleteMany({ where: { fromPath: { contains: prefix } } });
  await db.sitemapEntry.deleteMany({ where: { path: { contains: prefix } } });
  await db.contentEntry.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.contentTranslationGroup.deleteMany({ where: { id: group } });
  await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect();
});
describe("current canonical bilingual sitemap", () => {
  test("both endpoints read current publication without changing stored snapshots", async () => {
    const before = await db.sitemapEntry.count();
    const entries = await canonicalSitemapEntries();
    const english = entries.find((entry) => entry.path === enPath), arabic = entries.find((entry) => entry.path === arPath);
    expect(english?.languages).toEqual({ en: enPath, ar: arPath, "x-default": enPath });
    expect(arabic?.languages).toEqual(english?.languages);
    expect(entries.some((entry) => /scheduled|expired|stale/.test(entry.path) && entry.path.includes(prefix))).toBe(false);
    for (const route of ["/sitemap.xml", "/api/seo/sitemap"]) {
      const response = await fetch(baseUrl + route); expect(response.status).toBe(200);
      const xml = await response.text(); expect(xml).toContain(enPath); expect(xml).toContain(arPath); expect(xml).toContain('hreflang="ar"');
      expect(xml).not.toContain(prefix + "-stale"); expect(xml).not.toContain(prefix + "-scheduled");
    }
    expect(await db.sitemapEntry.count()).toBe(before);
    expect(entries.some((entry) => entry.path === "/ar/careers")).toBe(true);
    expect(entries.some((entry) => entry.path === "/calculators/roi")).toBe(true);
    expect(entries.some((entry) => entry.path.startsWith("/admin") || entry.path.startsWith("/account"))).toBe(false);
  });
  test("withdrawn translations disappear immediately and stop reciprocal hreflang", async () => {
    await db.contentEntry.update({ where: { slug: arSlug }, data: { status: "DRAFT" } });
    let entries = await canonicalSitemapEntries();
    expect(entries.find((entry) => entry.path === arPath)).toBeUndefined();
    expect(entries.find((entry) => entry.path === enPath)?.languages).toBeUndefined();
    expect((await resolveSpaRoutePage(enPath))?.localeAlternates).toBeNull();
    await db.contentEntry.update({ where: { slug: arSlug }, data: { status: "PUBLISHED" } });
    await db.seoMetadata.create({ data: { routeKey: `guides/${arSlug}`, noindex: true } });
    entries = await canonicalSitemapEntries();
    expect(entries.find((entry) => entry.path === arPath)?.noindex).toBe(true);
    expect(entries.find((entry) => entry.path === enPath)?.languages).toBeUndefined();
    expect((await resolveSpaRoutePage(enPath))?.localeAlternates).toBeNull();
    await db.seoMetadata.deleteMany({ where: { routeKey: `guides/${arSlug}` } });
  });
  test("redirect aliases and canonical overrides never become indexed duplicates", async () => {
    await db.redirect.create({ data: { fromPath: enPath, toPath: "/guides", statusCode: 301, isActive: true } });
    expect((await canonicalSitemapEntries()).find((entry) => entry.path === enPath)?.noindex).toBe(true);
    await db.redirect.deleteMany({ where: { fromPath: enPath } });
    await createSeoMetadataCommand(actor, { routeKey: `guides/${enSlug}`, canonicalPath: "/guides", noindex: false }, null);
    expect((await canonicalSitemapEntries()).find((entry) => entry.path === enPath)?.noindex).toBe(true);
    expect(spaRouteMetadata(enPath, "en", await resolveSpaRoutePage(enPath)).alternates).toEqual({ canonical: "/guides" });
    for (const canonicalPath of ["/ar/admin", "/ar/account", "/not-a-native-route", "/ar/cookie-settings"]) await expect(createSeoMetadataCommand(actor, { routeKey: `guides/${enSlug}`, canonicalPath, noindex: false }, null)).rejects.toMatchObject({ code: "SEO_CANONICAL_PATH_INVALID" });
  });
  test("XML is escaped and reflects changes with no worker", async () => {
    const xml = await sitemapXml("https://example.invalid/base?x=1&y=2");
    expect(xml).not.toContain("undefined"); expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).not.toContain(`<loc>https://example.invalid${enPath}</loc>`);
  });
});

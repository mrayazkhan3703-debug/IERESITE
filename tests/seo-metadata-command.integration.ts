import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createSeoMetadataCommand, rollbackSeoMetadataCommand, updateSeoMetadataCommand } from "@/server/domain/seo-metadata-command";
import { resolveSpaRoutePage, spaRouteMetadata } from "@/server/seo/route-contract";
import { generateSitemap } from "@/server/seo/sitemap";

const prefix = `seo-metadata-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "seo-editor@example.invalid", name: "SEO editor",
  organizationId: null, roles: ["OWNER"], permissions: ["seo:update"], mfaVerified: true,
};
let contentId = "";
let mediaId = "";
let seoId = "";

async function cleanup() {
  if (seoId) await db.auditLog.deleteMany({ where: { resourceId: seoId } });
  await db.seoMetadata.deleteMany({ where: { routeKey: `guides/${prefix}` } });
  await db.sitemapEntry.deleteMany({ where: { path: `/guides/${prefix}` } });
  if (contentId) await db.contentEntry.deleteMany({ where: { id: contentId } });
  if (mediaId) await db.mediaAsset.deleteMany({ where: { id: mediaId } });
  await db.user.deleteMany({ where: { id: userId } });
  seoId = "";
  contentId = "";
  mediaId = "";
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
  const content = await db.contentEntry.create({ data: {
    slug: prefix, title: "Published integration guide", contentType: "GUIDE", status: "PUBLISHED",
    locale: "en", body: "Fixture only.", publishedAt: new Date(Date.now() - 60_000),
  } });
  contentId = content.id;
  const media = await db.mediaAsset.create({ data: {
    storageKey: `${prefix}/og.jpg`, url: `/uploads/${prefix}-og.jpg`, mimeType: "image/jpeg", sizeBytes: 1200,
    kind: "IMAGE", isPrivate: false, altText: "Integration fixture only",
  } });
  mediaId = media.id;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional route SEO metadata commands", () => {
  test("applies safe overrides to server metadata and generated sitemap with audited version history", async () => {
    const routeKey = `guides/${prefix}`;
    const created = await createSeoMetadataCommand(actor, {
      routeKey, title: "SEO integration title", description: "SEO integration description", canonicalPath: `/guides/${prefix}`,
      noindex: true, ogImageMediaId: mediaId, priority: 0.4, changefreq: "monthly",
    }, "127.0.0.1");
    seoId = created.id;
    let seo = await db.seoMetadata.findUniqueOrThrow({ where: { id: seoId } });
    expect(await db.seoMetadataRevision.count({ where: { seoMetadataId: seo.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { resourceId: seo.id, action: "seo_metadata.create" } })).toBe(1);

    const contract = await resolveSpaRoutePage(`/guides/${prefix}`);
    expect(contract?.title).toBe("SEO integration title");
    expect(contract?.description).toBe("SEO integration description");
    expect(contract?.ogImageUrl).toBe(`/api/media/${encodeURIComponent(mediaId)}/content`);
    const metadata = spaRouteMetadata(`/guides/${prefix}`, "en", contract);
    expect(metadata.title).toBe("SEO integration title");
    expect(metadata.alternates).toMatchObject({ canonical: `/guides/${prefix}` });
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: `/api/media/${encodeURIComponent(mediaId)}/content` }] });

    const initial = await db.seoMetadataRevision.findFirstOrThrow({ where: { seoMetadataId: seo.id, version: 1 } });
    await expect(updateSeoMetadataCommand(actor, {
      seoMetadataId: seo.id, expectedUpdatedAt: new Date(seo.updatedAt.getTime() - 1).toISOString(), routeKey,
      title: "Stale SEO title", noindex: false,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    await expect(createSeoMetadataCommand(actor, { routeKey: "admin", title: "Private route", noindex: false }, null))
      .rejects.toMatchObject({ status: 422, code: "SEO_ROUTE_KEY_INVALID" });
    await expect(createSeoMetadataCommand(actor, { routeKey, title: "External canonical", canonicalPath: "https://example.invalid", noindex: false }, null))
      .rejects.toMatchObject({ status: 422, code: "SEO_CANONICAL_PATH_INVALID" });

    await updateSeoMetadataCommand(actor, {
      seoMetadataId: seo.id, expectedUpdatedAt: seo.updatedAt.toISOString(), routeKey,
      title: "Updated SEO title", description: "Updated description", canonicalPath: `/guides/${prefix}`,
      noindex: false, ogImageMediaId: mediaId, priority: 0.9, changefreq: "weekly",
    }, null);
    seo = await db.seoMetadata.findUniqueOrThrow({ where: { id: seo.id } });
    expect((await resolveSpaRoutePage(`/guides/${prefix}`))?.title).toBe("Updated SEO title");
    await rollbackSeoMetadataCommand(actor, seo.id, initial.id, seo.updatedAt.toISOString(), null);
    seo = await db.seoMetadata.findUniqueOrThrow({ where: { id: seo.id } });
    expect(seo.title).toBe("SEO integration title");
    expect(seo.noindex).toBe(true);

    await generateSitemap();
    const sitemapEntry = await db.sitemapEntry.findUniqueOrThrow({ where: { section_path: { section: "guides", path: `/guides/${prefix}` } } });
    expect(sitemapEntry.noindex).toBe(true);
    expect(sitemapEntry.priority).toBe(0.4);
    expect(sitemapEntry.changefreq).toBe("monthly");
    expect(await db.seoMetadataRevision.count({ where: { seoMetadataId: seo.id } })).toBe(3);
  });
});

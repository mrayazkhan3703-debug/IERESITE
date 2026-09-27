import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { generateSitemap } from "@/server/seo/sitemap";

export const dynamic = "force-dynamic";

const VALID_CHANGE_FREQUENCIES = new Set<NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>>([
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await generateSitemap();
  const entries = await db.sitemapEntry.findMany({
    where: { noindex: false },
    orderBy: [{ section: "asc" }, { path: "asc" }],
  });
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";

  return entries.map((entry) => ({
    url: new URL(entry.path, baseUrl).toString(),
    lastModified: entry.lastmod,
    changeFrequency: VALID_CHANGE_FREQUENCIES.has(
      entry.changefreq as NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>
    )
      ? (entry.changefreq as NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>)
      : "weekly",
    priority: entry.priority,
  }));
}

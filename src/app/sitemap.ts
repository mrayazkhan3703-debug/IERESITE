import type { MetadataRoute } from "next";
import { canonicalSitemapEntries } from "@/server/seo/sitemap";

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
  const entries = (await canonicalSitemapEntries()).filter((entry) => !entry.noindex);
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
    ...(entry.languages ? { alternates: { languages: Object.fromEntries(Object.entries(entry.languages).map(([locale, path]) => [locale, new URL(path, baseUrl).toString()])) } } : {}),
  }));
}

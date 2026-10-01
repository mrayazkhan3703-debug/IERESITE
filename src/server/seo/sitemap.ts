import { db } from "@/lib/db";
import { HttpError } from "@/server/auth";
import { publicCareerWhere } from "@/server/domain/career-query";
import { PUBLIC_PROFILE_WHERE, PUBLIC_COMMUNITY_WHERE, PUBLIC_DEVELOPER_WHERE, PUBLIC_PROJECT_WHERE, PUBLIC_PROPERTY_WHERE, publicContentWhere, publicMarketReportWhere } from "@/server/domain/visibility";
import { contentSitemapPath } from "./sitemap-content-path";
import { publicStaticRoutePaths } from "./route-contract";

export const PRIVATE_CRAWLER_PATHS = ["/api/", "/account", "/account/", "/admin", "/admin/", "/compare", "/cookie-settings", "/ar/account", "/ar/account/", "/ar/admin", "/ar/admin/", "/ar/compare", "/ar/cookie-settings"];
export type CanonicalSitemapEntry = {
  section: string; path: string; priority: number; changefreq: string; noindex: boolean;
  lastmod?: Date; languages?: Record<string, string>;
};
const QUERY_LIMIT = 25001, URL_LIMIT = 50000;
const localize = (path: string, locale: string) => locale === "ar" ? `/ar${path === "/" ? "" : path}` : path;
const routeKey = (path: string) => path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "");

/** Read current canonical visibility directly. Serving a sitemap never writes or relies on a worker. */
export async function canonicalSitemapEntries(now = new Date()): Promise<CanonicalSitemapEntry[]> {
  const [seo, redirects, properties, projects, communities, developers, agents, careers, content, reports] = await Promise.all([
    db.seoMetadata.findMany({ select: { routeKey: true, noindex: true, canonicalPath: true, priority: true, changefreq: true }, take: QUERY_LIMIT }),
    db.redirect.findMany({ where: { isActive: true }, select: { fromPath: true }, take: QUERY_LIMIT }),
    db.property.findMany({ where: PUBLIC_PROPERTY_WHERE, select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.project.findMany({ where: PUBLIC_PROJECT_WHERE, select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.community.findMany({ where: PUBLIC_COMMUNITY_WHERE, select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.developer.findMany({ where: PUBLIC_DEVELOPER_WHERE, select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.agent.findMany({ where: PUBLIC_PROFILE_WHERE, select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.careerOpening.findMany({ where: { ...publicCareerWhere(undefined, now), locale: { in: ["en", "ar"] } }, select: { slug: true, locale: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.contentEntry.findMany({ where: { ...publicContentWhere(now), locale: { in: ["en", "ar"] }, contentType: { in: ["GUIDE", "AREA_GUIDE", "ARTICLE", "PAGE", "INTERNATIONAL_GUIDE"] }, OR: [{ contentType: { not: "INTERNATIONAL_GUIDE" } }, { sourceName: { not: null }, sourceUrl: { startsWith: "https://" }, sourceVerifiedAt: { not: null, lte: now }, freshnessReviewDueAt: { gt: now } }] }, select: { slug: true, locale: true, contentType: true, translationGroupId: true, updatedAt: true }, take: QUERY_LIMIT }),
    db.marketReport.findMany({ where: publicMarketReportWhere(now), select: { slug: true, updatedAt: true }, take: QUERY_LIMIT }),
  ]);
  if ([seo, redirects, properties, projects, communities, developers, agents, careers, content, reports].some((rows) => rows.length === QUERY_LIMIT)) throw new HttpError(503, "Sitemap requires partitioning before exceeding its verified size limit.", "SITEMAP_SIZE_LIMIT");
  const seoByRoute = new Map(seo.map((row) => [row.routeKey, row])), redirected = new Set(redirects.map((row) => row.fromPath));
  const rows: CanonicalSitemapEntry[] = [], groups = new Map<string, CanonicalSitemapEntry[]>();
  const add = (section: string, path: string, locale: string, priority: number, changefreq: string, lastmod?: Date, group?: string) => {
    // Historical direct database writes must not create external, traversal or malformed URLs.
    if (path !== "/" && !/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(path)) return;
    const localized = localize(path, locale), metadata = seoByRoute.get(routeKey(path));
    const entry: CanonicalSitemapEntry = { section, path: localized, priority: metadata?.priority ?? priority, changefreq: metadata?.changefreq ?? changefreq,
      noindex: Boolean(metadata?.noindex || redirected.has(localized) || (metadata?.canonicalPath && metadata.canonicalPath !== localized)), ...(lastmod ? { lastmod } : {}) };
    rows.push(entry);
    if (rows.length > URL_LIMIT) throw new HttpError(503, "Sitemap requires partitioning before exceeding its verified size limit.", "SITEMAP_SIZE_LIMIT");
    if (group) groups.set(group, [...(groups.get(group) ?? []), entry]);
  };
  const bilingual = (section: string, path: string, priority: number, changefreq: string, lastmod?: Date) => {
    for (const locale of ["en", "ar"]) add(section, path, locale, priority, changefreq, lastmod, section + ":" + path);
  };
  for (const path of publicStaticRoutePaths()) bilingual("static", path, path === "/" ? 1 : 0.7, "weekly");
  for (const [section, entities] of [["properties", properties], ["projects", projects], ["communities", communities], ["developers", developers], ["agents", agents]] as const)
    for (const entity of entities) bilingual(section, `/${section}/${entity.slug}`, section === "projects" ? 0.8 : 0.7, "weekly", entity.updatedAt);
  for (const opening of careers) add("careers", `/careers/${opening.slug}`, opening.locale, 0.5, "weekly", opening.updatedAt, "careers:" + opening.slug);
  for (const entry of content) {
    const path = contentSitemapPath(entry.contentType, entry.slug);
    if (path) add(path.split("/")[1], path, entry.locale, 0.6, "monthly", entry.updatedAt, entry.translationGroupId ? `content:${entry.contentType}:${entry.translationGroupId}` : undefined);
  }
  for (const report of reports) bilingual("reports", `/market/reports/${report.slug}`, 0.6, "monthly", report.updatedAt);
  for (const members of groups.values()) {
    const en = members.find((entry) => !entry.noindex && entry.path !== "/ar" && !entry.path.startsWith("/ar/")), ar = members.find((entry) => !entry.noindex && (entry.path === "/ar" || entry.path.startsWith("/ar/")));
    if (en && ar) for (const member of [en, ar]) member.languages = { en: en.path, ar: ar.path, "x-default": en.path };
  }
  return rows.sort((a, b) => a.section.localeCompare(b.section) || a.path.localeCompare(b.path));
}

/** Optional operational snapshot. Readers continue to use canonical records during regeneration. */
export async function generateSitemap(): Promise<{ total: number }> {
  const entries = await canonicalSitemapEntries();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(865782)`;
    await tx.sitemapEntry.deleteMany({});
    for (let offset = 0; offset < entries.length; offset += 500) await tx.sitemapEntry.createMany({ data: entries.slice(offset, offset + 500).map(({ languages: _languages, ...entry }) => entry) });
  }, { timeout: 60000 });
  return { total: entries.length };
}

export function escapeSitemapXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}
export async function sitemapXml(baseUrl: string): Promise<string> {
  const entries = (await canonicalSitemapEntries()).filter((entry) => !entry.noindex);
  const absolute = (path: string) => escapeSitemapXml(new URL(path, baseUrl).toString());
  const urls = entries.map((entry) => `  <url>\n    <loc>${absolute(entry.path)}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod.toISOString()}</lastmod>` : ""}${Object.entries(entry.languages ?? {}).map(([language, path]) => `\n    <xhtml:link rel="alternate" hreflang="${language}" href="${absolute(path)}" />`).join("")}\n    <changefreq>${escapeSitemapXml(entry.changefreq)}</changefreq>\n    <priority>${entry.priority.toFixed(1)}</priority>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>`;
}
export function robotsTxt(baseUrl: string): string {
  return ["User-agent: *", "Allow: /", ...PRIVATE_CRAWLER_PATHS.map((path) => `Disallow: ${path}`), `Sitemap: ${new URL("/sitemap.xml", baseUrl).toString()}`, ""].join("\n");
}

/** Redirect lookup (DB-driven; admin managed; audited) */
export async function lookupRedirect(fromPath: string): Promise<{ to: string; statusCode: number } | null> {
  const r = await db.redirect.findFirst({ where: { fromPath, isActive: true } });
  if (!r) return null;
  // avoid chains: single hop only
  // Hit counters are operational metrics, not redirect edits; leave updatedAt
  // stable so analytics traffic cannot invalidate an Admin optimistic version.
  await db.$executeRaw`UPDATE "Redirect" SET "hits" = "hits" + 1 WHERE "id" = ${r.id}`.catch(() => {});
  return { to: r.toPath, statusCode: r.statusCode };
}

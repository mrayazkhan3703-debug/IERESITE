/**
 * SEO module (Q22): sitemap index generation (dynamic sections), robots policy,
 * redirect engine, route metadata. Sitemap entries persisted + event-regenerated.
 */
import { db } from "@/lib/db";
import {
  PUBLIC_AGENT_WHERE,
  PUBLIC_COMMUNITY_WHERE,
  PUBLIC_DEVELOPER_WHERE,
  PUBLIC_PROJECT_WHERE,
  PUBLIC_PROPERTY_WHERE,
  publicContentWhere,
  publicMarketReportWhere,
} from "@/server/domain/visibility";
import { contentSitemapPath } from "@/server/seo/sitemap-content-path";

const STATIC_ROUTES: { path: string; priority: number; changefreq: string }[] = [
  { path: "/", priority: 1.0, changefreq: "daily" },
  { path: "/buy", priority: 0.9, changefreq: "daily" },
  { path: "/rent", priority: 0.9, changefreq: "daily" },
  { path: "/off-plan", priority: 0.9, changefreq: "daily" },
  { path: "/projects", priority: 0.9, changefreq: "daily" },
  { path: "/communities", priority: 0.8, changefreq: "weekly" },
  { path: "/developers", priority: 0.8, changefreq: "weekly" },
  { path: "/agents", priority: 0.8, changefreq: "weekly" },
  { path: "/invest", priority: 0.8, changefreq: "weekly" },
  { path: "/invest/opportunities", priority: 0.7, changefreq: "daily" },
  { path: "/market", priority: 0.8, changefreq: "weekly" },
  { path: "/market/transactions", priority: 0.7, changefreq: "weekly" },
  { path: "/market/rents", priority: 0.7, changefreq: "weekly" },
  { path: "/international", priority: 0.8, changefreq: "weekly" },
  { path: "/sell", priority: 0.8, changefreq: "monthly" },
  { path: "/sell/valuation", priority: 0.7, changefreq: "monthly" },
  { path: "/guides", priority: 0.7, changefreq: "weekly" },
  { path: "/insights", priority: 0.7, changefreq: "weekly" },
  { path: "/about", priority: 0.5, changefreq: "monthly" },
  { path: "/about/team", priority: 0.5, changefreq: "monthly" },
  { path: "/contact", priority: 0.6, changefreq: "monthly" },
  { path: "/faq", priority: 0.6, changefreq: "monthly" },
  { path: "/advisor", priority: 0.7, changefreq: "monthly" },
  { path: "/consultation", priority: 0.7, changefreq: "monthly" },
];

/** Regenerate sitemap entries from canonical DB (event-driven; also on-demand) */
export async function generateSitemap(): Promise<{ total: number }> {
  // Clear dynamic sections
  await db.sitemapEntry.deleteMany({ where: { section: { not: "static" } } });
  const seoMetadata = await db.seoMetadata.findMany({ select: { routeKey: true, noindex: true, priority: true, changefreq: true } });
  const seoByRoute = new Map(seoMetadata.map((row) => [row.routeKey, row]));

  const properties = await db.property.findMany({
    where: PUBLIC_PROPERTY_WHERE,
    select: { slug: true, updatedAt: true },
  });
  const projects = await db.project.findMany({
    where: PUBLIC_PROJECT_WHERE,
    select: { slug: true, updatedAt: true },
  });
  const communities = await db.community.findMany({
    where: PUBLIC_COMMUNITY_WHERE,
    select: { slug: true, updatedAt: true },
  });
  const developers = await db.developer.findMany({ where: PUBLIC_DEVELOPER_WHERE, select: { slug: true, updatedAt: true } });
  const agents = await db.agent.findMany({ where: PUBLIC_AGENT_WHERE, select: { slug: true, updatedAt: true } });
  const careers = await db.careerOpening.findMany({
    where: { locale: "en", status: "PUBLISHED", publishedAt: { not: null, lte: new Date() }, OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }] },
    select: { slug: true, updatedAt: true },
  });
  const content = await db.contentEntry.findMany({
    where: { ...publicContentWhere(), locale: "en", contentType: { in: ["GUIDE", "AREA_GUIDE", "ARTICLE", "PAGE", "INTERNATIONAL_GUIDE"] }, OR: [{ contentType: { not: "INTERNATIONAL_GUIDE" } }, { sourceName: { not: null }, sourceUrl: { startsWith: "https://" }, sourceVerifiedAt: { not: null, lte: new Date() }, freshnessReviewDueAt: { gt: new Date() } }] },
    select: { slug: true, contentType: true, updatedAt: true },
  });
  const reports = await db.marketReport.findMany({
    where: publicMarketReportWhere(),
    select: { slug: true, updatedAt: true },
  });

  const rows: { section: string; path: string; priority: number; changefreq: string; noindex: boolean; lastmod: Date }[] = [];
  const addRow = (section: string, path: string, priority: number, changefreq: string, lastmod: Date) => {
    const routeKey = path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "");
    const metadata = seoByRoute.get(routeKey);
    rows.push({
      section, path,
      priority: metadata?.priority ?? priority,
      changefreq: metadata?.changefreq ?? changefreq,
      noindex: metadata?.noindex ?? false,
      lastmod,
    });
  };

  for (const p of properties) {
    addRow("properties", `/properties/${p.slug}`, 0.7, "daily", p.updatedAt);
  }
  for (const p of projects) {
    addRow("projects", `/projects/${p.slug}`, 0.8, "weekly", p.updatedAt);
  }
  for (const c of communities) {
    addRow("communities", `/communities/${c.slug}`, 0.7, "weekly", c.updatedAt);
  }
  for (const d of developers) {
    addRow("developers", `/developers/${d.slug}`, 0.6, "monthly", d.updatedAt);
  }
  for (const a of agents) {
    addRow("agents", `/agents/${a.slug}`, 0.6, "monthly", a.updatedAt);
  }
  for (const opening of careers) addRow("careers", `/careers/${opening.slug}`, 0.5, "weekly", opening.updatedAt);
  for (const c of content) {
    const path = contentSitemapPath(c.contentType, c.slug);
    if (path) addRow(c.contentType === "ARTICLE" ? "insights" : c.contentType === "INTERNATIONAL_GUIDE" ? "international" : c.contentType === "PAGE" ? "pages" : "guides", path, 0.6, "monthly", c.updatedAt);
  }
  for (const r of reports) {
    addRow("reports", `/market/reports/${r.slug}`, 0.6, "monthly", r.updatedAt);
  }

  for (const row of rows) {
    await db.sitemapEntry.upsert({
      where: { section_path: { section: row.section, path: row.path } },
      create: { ...row },
      update: { ...row },
    });
  }

  // static section maintenance
  for (const s of STATIC_ROUTES) {
    const routeKey = s.path === "/" ? "home" : s.path.slice(1);
    const metadata = seoByRoute.get(routeKey);
    const priority = metadata?.priority ?? s.priority;
    const changefreq = metadata?.changefreq ?? s.changefreq;
    const noindex = metadata?.noindex ?? false;
    await db.sitemapEntry.upsert({
      where: { section_path: { section: "static", path: s.path } },
      create: { section: "static", path: s.path, priority, changefreq, noindex },
      update: { priority, changefreq, noindex },
    });
  }

  return { total: rows.length + STATIC_ROUTES.length };
}

export async function sitemapXml(baseUrl: string): Promise<string> {
  const entries = await db.sitemapEntry.findMany({ where: { noindex: false }, orderBy: [{ section: "asc" }, { path: "asc" }] });
  const urls = entries
    .map((e) => {
      // hash routes map to real paths at migration (ADR-001); sitemap emits canonical paths
      return `  <url>\n    <loc>${baseUrl}${e.path}</loc>\n    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function robotsTxt(baseUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    `Disallow: /api/`,
    `Disallow: /*/account`,
    `Disallow: /*/admin`,
    `Disallow: /*/compare`,
    "", // internal search states default non-indexable (F10)
    `Sitemap: ${baseUrl}/sitemap.xml`,
    "",
  ].join("\n");
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

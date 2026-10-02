import { publicCareerWhere } from "@/server/domain/career-query";
import type { Metadata } from "next";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  getAgentDetailV2,
  getCommunityDetailV2,
  getDeveloperDetailV2,
  getPropertyDetailV2,
  getProjectDetailV2,
} from "@/server/domain/read-models";
import { publicContentWhere, publicMarketReportWhere } from "@/server/domain/visibility";
import { publicContentLocaleAlternates } from "@/server/seo/content-locale";
import { OG_IMAGE } from "@/lib/seo-schema";
import { parseSiteSettings } from "@/lib/site-settings";

export type RouteContract = {
  title: string;
  description?: string | null;
  noindex?: boolean;
  localeAlternates?: { en: string; ar: string; "x-default": string } | null;
  canonicalPath?: string | null;
  ogImageUrl?: string | null;
};

const EXACT_ROUTES: Record<string, RouteContract> = {
  "/": { title: "Home" },
  "/properties": { title: "Property Search" },
  "/properties/map": { title: "Map Search" },
  "/buy": { title: "Buy" },
  "/rent": { title: "Rent" },
  "/off-plan": { title: "Off-Plan" },
  "/projects": { title: "New Projects" },
  "/developers": { title: "Developers" },
  "/communities": { title: "Communities" },
  "/agents": { title: "Team & Advisors" },
  "/invest": { title: "Investment Hub" },
  "/invest/opportunities": { title: "Investment Opportunities" },
  "/calculators": { title: "Investor Tools" },
  "/market": { title: "Market Intelligence" },
  "/atlas": { title: "Dubai Investment Atlas", noindex: true },
  "/market/transactions": { title: "Transactions Explorer" },
  "/market/rents": { title: "Rental Trends" },
  "/guides": { title: "Guides" },
  "/international": { title: "International Buyers" },
  "/sell": { title: "Sell" },
  "/sell/list": { title: "List Property" },
  "/sell/valuation": { title: "Valuation" },
  "/about": { title: "About" },
  "/about/team": { title: "Team & Advisors", canonicalPath: "/agents" },
  "/careers": { title: "Careers" },
  "/contact": { title: "Contact" },
  "/insights": { title: "Insights" },
  "/faq": { title: "FAQ" },
  "/compare": { title: "Compare", noindex: true },
  "/account": { title: "Account", noindex: true },
  "/account/login": { title: "Sign In", noindex: true },
  "/account/register": { title: "Create Account", noindex: true },
  "/account/verify-email": { title: "Verify Email", noindex: true },
  "/account/reset-password": { title: "Reset Password", noindex: true },
  "/account/confirm-email-change": { title: "Confirm Email", noindex: true },
  "/account/accept-invite": { title: "Accept Staff Invitation", noindex: true },
  "/account/favorites": { title: "Saved Properties", noindex: true },
  "/account/saved-searches": { title: "Saved Searches", noindex: true },
  "/account/alerts": { title: "Alerts", noindex: true },
  "/account/preferences": { title: "Preferences", noindex: true },
  "/account/portfolio": { title: "Portfolio", noindex: true },
  "/advisor": { title: "AI Property Advisor" },
  "/consultation": { title: "Book a Consultation" },
  "/privacy": { title: "Privacy" },
  "/terms": { title: "Terms" },
  "/cookie-settings": { title: "Cookie Settings", noindex: true },
};

/** Shared inventory of concrete public routes; private routes never enter a sitemap. */
export function publicStaticRoutePaths(): string[] {
  return [...Object.entries(EXACT_ROUTES).filter(([, contract]) => !contract.noindex).map(([path]) => path),
    ...["roi", "yield", "mortgage", "payment-plan", "currency"].map((slug) => `/calculators/${slug}`)];
}

const DYNAMIC_ROUTES: Array<{ pattern: RegExp; contract: RouteContract }> = [
  { pattern: /^\/properties\/[^/]+$/, contract: { title: "Property" } },
  { pattern: /^\/projects\/[^/]+$/, contract: { title: "Project" } },
  { pattern: /^\/developers\/[^/]+$/, contract: { title: "Developer" } },
  { pattern: /^\/communities\/[^/]+$/, contract: { title: "Community" } },
  { pattern: /^\/agents\/[^/]+$/, contract: { title: "Advisor" } },
  { pattern: /^\/calculators\/(?:roi|yield|mortgage|payment-plan|currency)$/, contract: { title: "Calculator" } },
  { pattern: /^\/market\/reports\/[^/]+$/, contract: { title: "Market Report" } },
  { pattern: /^\/guides\/[^/]+$/, contract: { title: "Guide" } },
  { pattern: /^\/international\/[^/]+$/, contract: { title: "International Guide" } },
  { pattern: /^\/insights\/[^/]+$/, contract: { title: "Insight" } },
  { pattern: /^\/pages\/[^/]+$/, contract: { title: "Page" } },
  { pattern: /^\/careers\/[^/]+$/, contract: { title: "Career opening" } },
];

export function resolveSpaRoute(path: string): RouteContract | null {
  const normalized = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (EXACT_ROUTES[normalized]) return EXACT_ROUTES[normalized];
  if (normalized === "/admin" || normalized.startsWith("/admin/")) {
    return { title: "Admin", noindex: true };
  }
  return DYNAMIC_ROUTES.find((route) => route.pattern.test(normalized))?.contract ?? null;
}

async function resolveSpaRoutePageBase(path: string, locale: "en" | "ar"): Promise<RouteContract | null> {
  const contract = resolveSpaRoute(path);
  if (!contract) return null;
  const normalizedPath = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (normalizedPath === "/about/team") return { ...contract, canonicalPath: locale === "ar" ? "/ar/agents" : "/agents", localeAlternates: null };
  const isExactRoute = Object.hasOwn(EXACT_ROUTES, normalizedPath);

  const parts = path.split("/").filter(Boolean);
  const slug = parts.at(-1);
  if (!slug) return contract;

  if (parts.length === 2 && parts[0] === "projects") {
    const entity = await getProjectDetailV2(slug);
    return entity ? { title: entity.name, description: entity.summary ?? entity.tagline } : null;
  }
  if (!isExactRoute && parts.length === 2 && parts[0] === "properties") {
    const entity = await getPropertyDetailV2(slug);
    if (!entity) return null;
    const description = entity.shortDescription ?? `${entity.propertyType} in ${entity.community.name}. ${entity.bedrooms === 0 ? "Studio" : `${entity.bedrooms} bedroom`}, ${entity.bathrooms} bath${entity.builtUpAreaSqft ? `, ${entity.builtUpAreaSqft.toLocaleString("en-US")} sqft` : ""}.`;
    const primary = entity.media[0];
    return { title: entity.title, description, ogImageUrl: (primary?.kind === "IMAGE" ? primary.url : primary?.posterUrl) ?? entity.media.find((media) => media.kind === "IMAGE")?.url ?? OG_IMAGE.url };
  }
  if (parts.length === 2 && parts[0] === "developers") {
    const entity = await getDeveloperDetailV2(slug);
    return entity ? { title: entity.name, description: entity.summary } : null;
  }
  if (parts.length === 2 && parts[0] === "communities") {
    const entity = await getCommunityDetailV2(slug);
    return entity ? { title: entity.name, description: entity.summary } : null;
  }
  if (parts.length === 2 && parts[0] === "agents") {
    const entity = await getAgentDetailV2(slug);
    return entity ? { title: entity.name, description: entity.bio } : null;
  }
  if (parts.length === 3 && parts[0] === "market" && parts[1] === "reports") {
    const entity = await db.marketReport.findFirst({
      where: { slug, ...publicMarketReportWhere() },
      select: { title: true, summary: true },
    });
    return entity ? { title: entity.title, description: entity.summary } : null;
  }
  if (parts.length === 2 && parts[0] === "careers") {
    const now = new Date();
    const where = { slug, ...publicCareerWhere(locale, now) };
    const opening = await db.careerOpening.findFirst({ where, select: { slug: true, locale: true, title: true, summary: true, seoTitle: true, seoDescription: true } });
    if (!opening) return null;
    const peerLocale = locale === "en" ? "ar" : "en";
    const peer = await db.careerOpening.findFirst({ where: { ...where, locale: peerLocale }, select: { slug: true, locale: true } });
    if (!peer) return { title: opening.seoTitle || opening.title, description: opening.seoDescription || opening.summary, localeAlternates: null };
    const englishSlug = locale === "en" ? opening.slug : peer.slug;
    const arabicSlug = locale === "ar" ? opening.slug : peer.slug;
    return { title: opening.seoTitle || opening.title, description: opening.seoDescription || opening.summary, localeAlternates: { en: `/careers/${englishSlug}`, ar: `/ar/careers/${arabicSlug}`, "x-default": `/careers/${englishSlug}` } };
  }
  if (parts.length === 2 && ["guides", "international", "insights", "pages"].includes(parts[0])) {
    const contentType = parts[0] === "international" ? "INTERNATIONAL_GUIDE" : parts[0] === "pages" ? "PAGE" :
      parts[0] === "insights" ? { in: ["ARTICLE", "GUIDE"] } : { in: ["GUIDE", "AREA_GUIDE"] };
    const paired = await db.contentEntry.findFirst({
      where: {
        slug, locale, ...publicContentWhere(), contentType,
        ...(parts[0] === "international" ? { sourceName: { not: null }, sourceUrl: { startsWith: "https://" }, sourceVerifiedAt: { not: null, lte: new Date() }, freshnessReviewDueAt: { gt: new Date() } } : {}),
      },
      select: {
        title: true, excerpt: true, locale: true, slug: true, status: true, publishedAt: true, sourceName: true, sourceUrl: true, sourceVerifiedAt: true, freshnessReviewDueAt: true,
        translationGroup: { select: { entries: { select: { locale: true, slug: true, status: true, publishedAt: true, sourceName: true, sourceUrl: true, sourceVerifiedAt: true, freshnessReviewDueAt: true } } } },
      },
    });
    return paired ? {
      title: paired.title,
      description: paired.excerpt,
      localeAlternates: publicContentLocaleAlternates(parts[0], [
        paired,
        ...(paired.translationGroup?.entries ?? []),
      ]),
    } : null;
  }

  return contract;
}

export const resolveSpaRoutePage = cache(async (path: string, locale: "en" | "ar" = "en"): Promise<RouteContract | null> => {
  const contract = await resolveSpaRoutePageBase(path, locale);
  if (!contract) return null;
  const routeKey = path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "");
  const candidateAlternates = contract.noindex ? null : contract.localeAlternates === undefined
    ? { en: path, ar: `/ar${path === "/" ? "" : path}`, "x-default": path } : contract.localeAlternates;
  const alternatePaths = Object.values(candidateAlternates ?? {});
  const alternateKey = (value: string) => value === "/" || value === "/ar" ? "home" : value.replace(/^\/ar\//, "/").replace(/^\/+|\/+$/g, "");
  const [seoRows, redirects, settingsRow] = await Promise.all([
    db.seoMetadata.findMany({ where: { routeKey: { in: [...new Set([routeKey, ...alternatePaths.map(alternateKey)])] } } }),
    alternatePaths.length ? db.redirect.findMany({ where: { fromPath: { in: alternatePaths }, isActive: true }, select: { fromPath: true } }) : Promise.resolve([]),
    db.siteSetting.findUnique({ where: { id: "public" }, select: { settingsJson: true } }),
  ]);
  const seo = seoRows.find((row) => row.routeKey === routeKey);
  const localeAlternates = candidateAlternates && alternatePaths.every((alternatePath) => {
    const metadata = seoRows.find((row) => row.routeKey === alternateKey(alternatePath));
    return !metadata?.noindex && (!metadata?.canonicalPath || metadata.canonicalPath === alternatePath) && !redirects.some((redirect) => redirect.fromPath === alternatePath);
  }) ? candidateAlternates : null;
  let siteSettings = null;
  try { siteSettings = settingsRow ? parseSiteSettings(JSON.parse(settingsRow.settingsJson)) : null; } catch { siteSettings = null; }
  const copyPrefix = path === "/about" ? "about" : path === "/careers" ? "careers" : path === "/international" ? "international" : path === "/" ? "home" : null;
  const copyTitle = copyPrefix ? siteSettings?.pageCopy[`${copyPrefix}Title`]?.[locale] : null;
  const copyDescription = copyPrefix ? siteSettings?.pageCopy[`${copyPrefix}Intro`]?.[locale] : null;
  const imageIds = [seo?.ogImageMediaId, siteSettings?.defaultOgMediaId, siteSettings?.fallbackImageMediaId].filter((value): value is string => Boolean(value));
  const images = imageIds.length ? await db.mediaAsset.findMany({ where: { id: { in: imageIds }, isPrivate: false, kind: "IMAGE" }, select: { id: true } }) : [];
  const availableIds = new Set(images.map((image) => image.id));
  const imageId = imageIds.find((id) => availableIds.has(id));
  const image = imageId ? { id: imageId } : null;
  if (!seo && !image && !copyTitle && !copyDescription) return { ...contract, localeAlternates };
  return {
    ...contract,
    localeAlternates,
    title: seo?.title?.trim() || copyTitle || contract.title,
    description: seo?.description?.trim() || copyDescription || contract.description,
    noindex: Boolean(contract.noindex || seo?.noindex),
    canonicalPath: contract.canonicalPath ?? seo?.canonicalPath,
    ogImageUrl: image ? `/api/media/${encodeURIComponent(image.id)}/content` : contract.ogImageUrl ?? null,
  };
});

export function spaRouteMetadata(
  path: string,
  locale: "en" | "ar",
  resolvedContract?: RouteContract | null
): Metadata {
  const contract = resolvedContract === undefined ? resolveSpaRoute(path) : resolvedContract;
  if (!contract) return { title: "Page not found", robots: { index: false, follow: false } };

  const englishPath = path === "/" ? "/" : path;
  const canonical = contract.canonicalPath ?? (locale === "ar" ? `/ar${path === "/" ? "" : path}` : englishPath);
  const defaultCanonical = locale === "ar" ? `/ar${path === "/" ? "" : path}` : englishPath;
  const alternates = canonical !== defaultCanonical ? null : contract.localeAlternates === undefined
    ? { en: englishPath, ar: `/ar${path === "/" ? "" : path}`, "x-default": englishPath }
    : contract.localeAlternates;
  return {
    title: contract.title,
    description: contract.description ?? undefined,
    alternates: contract.noindex
      ? { canonical }
      : alternates
        ? { canonical, languages: alternates }
        : { canonical },
    openGraph: {
      title: contract.title,
      description: contract.description ?? undefined,
      url: canonical,
      locale: locale === "ar" ? "ar_AE" : "en_AE",
      ...(contract.ogImageUrl ? { images: [{ url: contract.ogImageUrl }] } : {}),
    },
    ...(contract.ogImageUrl ? { twitter: { images: [contract.ogImageUrl] } } : {}),
    robots: contract.noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}

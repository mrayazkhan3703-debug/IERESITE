import type { Metadata } from "next";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  getAgentDetailV2,
  getCommunityDetailV2,
  getDeveloperDetailV2,
  getProjectDetailV2,
} from "@/server/domain/read-models";
import { publicContentWhere, publicMarketReportWhere } from "@/server/domain/visibility";
import { publicContentLocaleAlternates } from "@/server/seo/content-locale";

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
  "/agents": { title: "Advisors" },
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
  "/about/team": { title: "Team" },
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

const DYNAMIC_ROUTES: Array<{ pattern: RegExp; contract: RouteContract }> = [
  { pattern: /^\/projects\/[^/]+$/, contract: { title: "Project" } },
  { pattern: /^\/developers\/[^/]+$/, contract: { title: "Developer" } },
  { pattern: /^\/communities\/[^/]+$/, contract: { title: "Community" } },
  { pattern: /^\/agents\/[^/]+$/, contract: { title: "Advisor" } },
  { pattern: /^\/calculators\/(?:roi|yield|mortgage|payment-plan|currency)$/, contract: { title: "Calculator" } },
  { pattern: /^\/market\/reports\/[^/]+$/, contract: { title: "Market Report" } },
  { pattern: /^\/guides\/[^/]+$/, contract: { title: "Guide" } },
  { pattern: /^\/international\/[^/]+$/, contract: { title: "International Guide" } },
  { pattern: /^\/insights\/[^/]+$/, contract: { title: "Insight" } },
];

export function resolveSpaRoute(path: string): RouteContract | null {
  const normalized = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (EXACT_ROUTES[normalized]) return EXACT_ROUTES[normalized];
  if (normalized === "/admin" || normalized.startsWith("/admin/")) {
    return { title: "Admin", noindex: true };
  }
  return DYNAMIC_ROUTES.find((route) => route.pattern.test(normalized))?.contract ?? null;
}

async function resolveSpaRoutePageBase(path: string): Promise<RouteContract | null> {
  const contract = resolveSpaRoute(path);
  if (!contract) return null;

  const parts = path.split("/").filter(Boolean);
  const slug = parts.at(-1);
  if (!slug) return contract;

  if (parts.length === 2 && parts[0] === "projects") {
    const entity = await getProjectDetailV2(slug);
    return entity ? { title: entity.name, description: entity.summary ?? entity.tagline } : null;
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
  if (parts.length === 2 && ["guides", "international", "insights"].includes(parts[0])) {
    const contentType =
      parts[0] === "insights" ? { in: ["ARTICLE", "GUIDE"] } : { in: ["GUIDE", "AREA_GUIDE"] };
    const paired = await db.contentEntry.findFirst({
      where: { slug, ...publicContentWhere(), contentType },
      select: {
        title: true, excerpt: true, locale: true, slug: true, status: true, publishedAt: true,
        translationGroup: { select: { entries: { select: { locale: true, slug: true, status: true, publishedAt: true } } } },
      },
    });
    return paired ? {
      title: paired.title,
      description: paired.excerpt,
      localeAlternates: publicContentLocaleAlternates(parts[0], [
        { locale: paired.locale, slug: paired.slug, status: paired.status, publishedAt: paired.publishedAt },
        ...(paired.translationGroup?.entries ?? []),
      ]),
    } : null;
  }

  return contract;
}

export const resolveSpaRoutePage = cache(async (path: string): Promise<RouteContract | null> => {
  const contract = await resolveSpaRoutePageBase(path);
  if (!contract) return null;
  const routeKey = path === "/" ? "home" : path.replace(/^\/+|\/+$/g, "");
  const seo = await db.seoMetadata.findUnique({ where: { routeKey } });
  if (!seo) return contract;
  const image = seo.ogImageMediaId
    ? await db.mediaAsset.findFirst({ where: { id: seo.ogImageMediaId, isPrivate: false, kind: "IMAGE" }, select: { id: true } })
    : null;
  return {
    ...contract,
    title: seo.title?.trim() || contract.title,
    description: seo.description?.trim() || contract.description,
    noindex: Boolean(contract.noindex || seo.noindex),
    canonicalPath: seo.canonicalPath,
    ogImageUrl: image ? `/api/media/${encodeURIComponent(image.id)}/content` : null,
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
  const alternates = contract.localeAlternates === undefined
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

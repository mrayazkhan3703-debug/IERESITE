"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { SearchBar } from "@/components/search/search-bar";
import { PropertyCard } from "@/components/property/property-card";
import { SectionHeading, GridSkeleton, ProvenanceBadge } from "@/components/common";
import { usePageMeta } from "@/components/layout/app-shell";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import type { ListingCardDTO, SearchResponse } from "@/lib/types";
import { formatNumber } from "@/lib/money";
import { localeOf, t } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared hub view for Buy (A02), Rent (A03), Off-Plan (A04) */
export function HubView({
  variant,
}: {
  variant: "buy" | "rent" | "offplan";
}) {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const isRent = variant === "rent";
  const isOffPlan = variant === "offplan";
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [communities, setCommunities] = React.useState<{ id: string; name: string; slug: string; count: number }[]>([]);

  usePageMeta({
    title: isRent ? "Properties for Rent in Dubai" : isOffPlan ? "Off-Plan Properties in Dubai" : "Properties for Sale in Dubai",
    description: isRent
      ? "Explore rental apartments, villas and townhouses across Dubai — transparent filters, price context and direct advisor contact."
      : isOffPlan
      ? "Off-plan apartments and villas from Dubai's leading developers — payment plans with verification status, handover schedules and escrow-backed guidance."
      : "Browse curated homes and investment properties for sale across Dubai's prime communities — with source-aware pricing and advisor support.",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: isRent ? "Properties for rent in Dubai" : isOffPlan ? "Off-plan properties in Dubai" : "Properties for sale in Dubai",
      numberOfItems: data?.total,
    },
  });

  React.useEffect(() => {
    const params = new URLSearchParams({ limit: "9" });
    if (isRent) params.set("type", "rent");
    if (isOffPlan) params.set("offPlan", "1");
    api.get<SearchResponse>(`/api/search?${params}`).then(setData).catch(() => setData(null));
    api.get<{ communities: { id: string; name: string; slug: string; listingCount?: number }[] }>("/api/communities")
      .then((r) => setCommunities(r.communities.slice(0, 8).map((c) => ({ id: c.id, name: c.name, slug: c.slug, count: c.listingCount ?? 0 }))))
      .catch(() => {});
  }, [isRent, isOffPlan]);

  const copy = isRent
    ? {
        kicker: "Renting in Dubai",
        h1: "Find your next home in Dubai",
        lede: "Annual and short-stay rentals across the emirate — transparent pricing, furnishing status and service-charge context on every listing. Enquiries go straight to a specialist advisor.",
        searchTo: "/properties",
      }
    : isOffPlan
    ? {
        kicker: "Off-plan opportunities",
        h1: "Buy tomorrow's property at today's price",
        lede: "Off-plan launches from Dubai's leading developers. Every project page shows the payment plan with its verification status, handover schedule and escrow context — so you know exactly how certain each date is.",
        searchTo: "/properties",
      }
    : {
        kicker: "Buying in Dubai",
        h1: "Property for sale, curated and verified",
        lede: "Search real inventory across Dubai's prime communities. Every listing carries source and freshness metadata; every enquiry reaches a specialist with your full context.",
        searchTo: "/properties",
      };

  return (
    <div>
      <section className="border-b border-border/70 bg-sand/50 py-12 sm:py-16">
        <div className="container-page">
          <p className="kicker">{copy.kicker}</p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">{copy.h1}</h1>
          <p className="mt-4 max-w-2xl text-balance text-muted-foreground">{copy.lede}</p>
          <div className="mt-7 max-w-2xl">
            <SearchBar listingType={isRent ? "RENT" : "SALE"} size="md" mode={variant} />
          </div>
          {/* V2 U04 §12.1 — mode context bar + Browse-all CTA into the matching search mode */}
          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("search.mode.label", locale)}>
            {([
              { key: "buy", label: "search.mode.buy", active: variant === "buy" },
              { key: "rent", label: "search.mode.rent", active: variant === "rent" },
              { key: "offplan", label: "search.mode.offplan", active: variant === "offplan" },
              { key: "projects", label: "search.mode.projects", active: false },
            ] as const).map((m) => (
              <Link
                key={m.key}
                to="/properties"
                query={m.key === "buy" ? {} : { mode: m.key }}
                aria-current={m.active ? "true" : undefined}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui",
                  m.active
                    ? "border-brand bg-brand-soft text-brand-strong"
                    : "border-border bg-card text-foreground/80 hover:border-brand/50 hover:text-brand-strong"
                )}
              >
                {t(m.label, locale)}
              </Link>
            ))}
            <Button asChild size="sm" className="ml-auto gap-1">
              <Link
                to="/properties"
                query={
                  isRent ? { mode: "rent" } : isOffPlan ? { mode: "offplan" } : {}
                }
              >
                Browse all {data ? formatNumber(data.total) : ""}
                <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
          </div>
          {data && (
            <p className="num mt-4 text-sm text-muted-foreground">
              {formatNumber(data.total)} {isRent ? "rental" : isOffPlan ? "off-plan" : "for-sale"} properties available now
            </p>
          )}
        </div>
      </section>

      {/* Community chips */}
      <section className="container-page min-h-[266px] py-8 sm:min-h-[160px] lg:min-h-[112px]" aria-label="Popular communities">
        <div className="flex flex-wrap gap-2">
          {communities.map((c) => (
            <Link
              key={c.id}
              to={isRent ? "/properties" : "/properties"}
              query={{ type: isRent ? "rent" : undefined, community: c.slug, ...(isOffPlan ? { offPlan: "1" } : {}) }}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground/80 transition-ui hover:border-brand/50 hover:text-brand-strong"
            >
              {c.name} <span className="num text-xs text-muted-foreground">({c.count})</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Results */}
      <section className="container-page min-h-[320px] pb-16" aria-label="Listings">
        <SectionHeading
          kicker="Curated selection"
          title={isRent ? "Latest rentals" : isOffPlan ? "Off-plan highlights" : "Featured for sale"}
          action={
            <Button asChild variant="ghost" size="sm" className="gap-1 text-brand-strong">
              <Link to="/properties" query={{ type: isRent ? "rent" : undefined, ...(isOffPlan ? { offPlan: "1" } : {}) }}>
                View all <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          }
        />
        {data === null ? <GridSkeleton /> : data.results.length === 0 ? (
          <div className="grid min-h-[240px] place-items-center rounded-xl border border-border/60 bg-card/50 px-5 text-center text-sm text-muted-foreground">
            Listings are loading for this market. Check back soon or browse all properties.
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.results.slice(0, 9).map((l: ListingCardDTO) => <PropertyCard key={l.id} listing={l} />)}
          </div>
        )}
        {isOffPlan && (
          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <ProvenanceBadge chip={{ sourceType: "DEMO", isDemoData: true }} />
            Development environment — inventory is clearly-labeled demo fixture data; payment plans are illustrative until verified.
          </p>
        )}
      </section>
    </div>
  );
}

export default function BuyHubView() {
  return <HubView variant="buy" />;
}

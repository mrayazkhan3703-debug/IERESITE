"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, GridSkeleton } from "@/components/common";
import { formatMoney, formatNumber } from "@/lib/money";
import { events } from "@/lib/analytics-tracker";
import type { CommunityCardDTO } from "@/lib/types";
import { MapPin } from "lucide-react";

export default function CommunitiesView() {
  const [communities, setCommunities] = React.useState<CommunityCardDTO[] | null>(null);

  usePageMeta({
    title: "Dubai Communities & Areas — Living and Investment Guides",
    description:
      "Explore Dubai's communities and areas — price-per-sqft context, lifestyle, transport, schools and current inventory for Marina, Downtown, Palm Jumeirah, JVC and more.",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Dubai communities",
      numberOfItems: communities?.length,
    },
  });

  React.useEffect(() => {
    api.get<{ communities: CommunityCardDTO[] }>("/api/communities").then((r) => setCommunities(r.communities)).catch(() => setCommunities([]));
  }, []);

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Communities" }]} />
      <div className="mt-4">
        <SectionHeading
          kicker="Area intelligence"
          title="Explore Dubai, community by community"
          as="h1"
          description="Lifestyle, price context, transport and schools — with the inventory, projects and market data for each area."
        />
      </div>

      {communities === null ? (
        <GridSkeleton count={6} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {communities.map((c) => (
            <Link
              key={c.id}
              to={`/communities/${c.slug}`}
              onClick={() => events.communityView(c.slug)}
              className="group overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.12)]"
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-sand">
                {c.image?.url ? (
                  <img
                    src={c.image.url}
                    alt={`${c.name}, Dubai`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <img
                    src={`/images/communities/${c.slug}.jpg`}
                    alt={`${c.name}, Dubai`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                {/* soft separation between photo and content */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/15 to-transparent" aria-hidden />
                <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5 text-[11px] font-medium text-white/95 drop-shadow-sm">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {c.areaType === "RESIDENTIAL" ? "Residential" : c.areaType === "COMMERCIAL" ? "Commercial" : "Mixed"}
                </div>
              </div>
              <div className="p-5">
                <h2 className="font-display text-lg font-semibold text-ink group-hover:text-brand-strong">{c.name}</h2>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.lifestyleTags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full bg-sand px-2.5 py-0.5 text-xs text-muted-foreground">{tag}</span>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                  <span className="num text-xs text-muted-foreground">{formatNumber(c.listingCount)} listings</span>
                  {c.avgPricePerSqft && (
                    <span className="num text-base font-semibold text-brand-strong transition-colors group-hover:text-brand">
                      ~{formatMoney(c.avgPricePerSqft.minor, { currency: "AED", compact: true })}
                      <span className="text-xs font-normal text-muted-foreground">/sqft</span>
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

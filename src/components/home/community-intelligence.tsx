"use client";

/**
 * Community Intelligence (V2 §11.7) — mini intelligence cards joining
 * /api/communities with per-community metrics. Missing fields render as
 * UnavailableValue or are omitted — never invented.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { DataStateBadge, UnavailableValue } from "@/components/common";
import { ChevronRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, formatMoney } from "@/lib/money";
import { formatPctPrecise } from "@/lib/format-precise";
import type { CommunityCardDTO, ProjectCardDTO } from "@/lib/types";
import type { CommunityMetricSet } from "@/components/home/use-home-data";

export function CommunityIntelligence({
  locale,
  communities,
  communityMetrics,
  projects,
}: {
  locale: Locale;
  communities: CommunityCardDTO[] | null;
  communityMetrics: Record<string, CommunityMetricSet> | null;
  projects: ProjectCardDTO[] | null;
}) {
  const six = React.useMemo(() => {
    if (!communities) return null;
    /* Rank by listing activity so the six shown are the most active. */
    const ranked = [...communities].sort(
      (a, b) => (communityMetrics?.[b.slug]?.transactionCount ?? 0) - (communityMetrics?.[a.slug]?.transactionCount ?? 0)
    );
    return ranked.slice(0, 6);
  }, [communities, communityMetrics]);

  const projectCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects ?? []) m.set(p.community.slug, (m.get(p.community.slug) ?? 0) + 1);
    return m;
  }, [projects]);

  return (
    <section className="section-contrast section" aria-labelledby="community-heading">
      <div className="container-page">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="kicker mb-2">{t("home.community.kicker", locale)}</p>
            <h2 id="community-heading" className="type-h2">
              {t("home.community.title", locale)}
            </h2>
            <p className="mt-2 text-balance text-muted-foreground">{t("home.community.subtitle", locale)}</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-brand-strong">
            <Link to="/communities">
              {t("home.community.viewAll", locale)} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>

        {six === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-card/60" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {six.map((c) => {
              const m = communityMetrics?.[c.slug];
              const pipeline = projectCounts.get(c.slug);
              return (
                <Link
                  key={c.id}
                  to={`/communities/${c.slug}`}
                  className="group overflow-hidden rounded-xl border border-border/70 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg"
                >
                  <div className="relative aspect-[16/8] overflow-hidden bg-sand">
                    <img
                      src={c.image?.url ?? `/images/communities/${c.slug}.jpg`}
                      alt={`${c.name}, Dubai`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-3.5 pb-2.5 pt-10">
                      <h3 className="font-display text-base font-semibold text-white">{c.name}</h3>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-4 text-[13px]">
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">Avg AED/sqft</dt>
                      <dd className="data-value mt-0.5 text-ink">
                        {c.avgPricePerSqft ? (
                          formatMoney(c.avgPricePerSqft.minor, { currency: "AED", compact: true })
                        ) : (
                          <UnavailableValue />
                        )}
                        {m?.avgPricePerSqft == null && c.avgPricePerSqft && <span className="sr-only"> — average of listed asking prices</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">{t("home.community.modeledYield", locale)}</dt>
                      <dd className="mt-0.5 flex items-center gap-1.5">
                        {m?.yieldPct != null ? (
                          <>
                            <span className="data-value text-ink">{formatPctPrecise(m.yieldPct, 1)}</span>
                            {m.state && <DataStateBadge state={m.state} />}
                          </>
                        ) : (
                          <UnavailableValue />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">{t("home.community.rent1br", locale)}</dt>
                      <dd className="data-value mt-0.5 text-ink">
                        {m?.avgRent1Br != null ? (
                          <span title="Modeled 1BR annual rent">
                            {formatMoney(String(Math.round(m.avgRent1Br * 100)), { currency: "AED", compact: true })}/yr
                          </span>
                        ) : (
                          <UnavailableValue />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">{t("home.community.transactions", locale)}</dt>
                      <dd className="data-value mt-0.5 text-ink">
                        {m?.transactionCount != null ? formatNumber(m.transactionCount) : <UnavailableValue />}
                      </dd>
                    </div>
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">{t("home.community.listings", locale)}</dt>
                      <dd className="num mt-0.5 text-ink">{formatNumber(c.listingCount ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="type-label text-[10px] text-muted-foreground">{t("home.community.projects", locale)}</dt>
                      <dd className="num mt-0.5 text-ink">
                        {pipeline !== undefined ? formatNumber(pipeline) : <span className="text-muted-foreground">0 tracked</span>}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

/**
 * Opportunity Radar (V2 §11.3) — explainable discovery.
 * Eight category lenses over the general listing pool; every match carries a
 * stated, checkable reason computed from real fields. Categories whose logic
 * needs data the list API does not expose are honestly disabled with a
 * tooltip — never silently dropped, never faked.
 */

import * as React from "react";
import { PropertyCard, type PropertyCommunityContext } from "@/components/property/property-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { DataStateBadge, GridSkeleton } from "@/components/common";
import { MobileDisclosure } from "@/components/common/mobile-disclosure";
import { ChevronRight, Radar as RadarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, fromMinor } from "@/lib/money";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import type { ListingCardDTO } from "@/lib/types";
import type { CommunityMetricSet } from "@/components/home/use-home-data";

type RadarReason = { reason: string; modeled: boolean } | null;

interface RadarCategory {
  key: string;
  label: string;
  test: (listing: ListingCardDTO, metrics: Record<string, CommunityMetricSet>) => RadarReason;
  /** Disabled when the underlying data is not available in this dataset. */
  disabled?: boolean;
}

const ENTRY_LEVEL_THRESHOLD = 1_600_000;
const HIGH_YIELD_THRESHOLD = 6;
const BELOW_AREA_MIN_PCT = 3;
const NEAR_HANDOVER_QUARTERS = 5;

function listingPsqft(l: ListingCardDTO): number | null {
  if (!l.areaSqft || l.areaSqft <= 0) return null;
  return fromMinor(l.price.minor) / l.areaSqft;
}

function quartersUntil(quarter: string, now = new Date()): number | null {
  const m = /^Q([1-4])\s+(\d{4})$/i.exec(quarter.trim());
  if (!m) return null;
  const q = Number(m[1]);
  const year = Number(m[2]);
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  return (year - now.getFullYear()) * 4 + (q - curQ);
}

const CATEGORIES: RadarCategory[] = [
  {
    key: "below-median",
    label: "Below area median",
    test: (l, metrics) => {
      const psqft = listingPsqft(l);
      const benchmark = metrics[l.community.slug]?.avgPricePerSqft;
      if (psqft === null || !benchmark || benchmark <= 0) return null;
      const pct = ((psqft - benchmark) / benchmark) * 100;
      if (pct > -BELOW_AREA_MIN_PCT) return null;
      return {
        reason: `${formatPctPrecise(Math.abs(pct), 0)} below ${l.community.name} area average asking AED/sqft`,
        modeled: true,
      };
    },
  },
  {
    key: "high-yield",
    label: "High modeled yield",
    test: (l, metrics) => {
      const y = metrics[l.community.slug]?.yieldPct;
      if (y === undefined || y < HIGH_YIELD_THRESHOLD) return null;
      return { reason: `${l.community.name} modeled gross yield ${formatPctPrecise(y, 1)} (community model)`, modeled: true };
    },
  },
  {
    key: "near-handover",
    label: "Near handover",
    test: (l) => {
      if (!l.handoverQuarter) return null;
      const q = quartersUntil(l.handoverQuarter);
      if (q === null || q < 0 || q > NEAR_HANDOVER_QUARTERS) return null;
      return { reason: `Handover ${l.handoverQuarter} — ${q === 0 ? "this quarter" : `${formatNumber(q)} ${q === 1 ? "quarter" : "quarters"} out`}`, modeled: false };
    },
  },
  {
    key: "post-handover-plan",
    label: "Post-handover plan",
    test: () => null,
    disabled: true,
  },
  {
    key: "waterfront",
    label: "Waterfront",
    test: (l) => {
      const seaView = l.view === "SEA";
      const waterfrontCommunity = l.community.slug === "dubai-marina" || l.community.slug === "palm-jumeirah";
      if (!seaView && !waterfrontCommunity) return null;
      return { reason: seaView ? `Sea-view unit in ${l.community.name}` : `Waterfront community — ${l.community.name}`, modeled: false };
    },
  },
  {
    key: "family",
    label: "Family-focused",
    test: (l) => {
      if (l.bedrooms < 3) return null;
      return { reason: `${formatNumber(l.bedrooms)} bedrooms — family-sized layout`, modeled: false };
    },
  },
  {
    key: "luxury-villa",
    label: "Luxury villas",
    test: (l) => {
      const price = fromMinor(l.price.minor);
      if (l.propertyType !== "VILLA" || price < 10_000_000) return null;
      return { reason: `${formatAEDPrecise(price)} villa — ultra-prime segment`, modeled: false };
    },
  },
  {
    key: "entry-level",
    label: "Entry-level",
    test: (l) => {
      const price = fromMinor(l.price.minor);
      if (price > ENTRY_LEVEL_THRESHOLD) return null;
      return { reason: `Entry price point — ${formatAEDPrecise(price)}`, modeled: false };
    },
  },
];

const DEFAULT_SELECTED = ["below-median", "high-yield"];

export function OpportunityRadar({
  locale,
  pool,
  communityMetrics,
  contextFor,
}: {
  locale: Locale;
  pool: ListingCardDTO[] | null;
  communityMetrics: Record<string, CommunityMetricSet> | null;
  contextFor: (communitySlug: string) => PropertyCommunityContext | undefined;
}) {
  const [selected, setSelected] = React.useState<string[]>(DEFAULT_SELECTED);
  const metrics = communityMetrics ?? {};

  const toggle = (key: string) => {
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  /* Explainable match set: union over selected lenses, each with its reason. */
  const matches = React.useMemo(() => {
    if (!pool) return null;
    const active = CATEGORIES.filter((c) => selected.includes(c.key));
    const out: { listing: ListingCardDTO; reason: string; modeled: boolean }[] = [];
    for (const listing of pool) {
      for (const cat of active) {
        const r = cat.test(listing, metrics);
        if (r) {
          out.push({ listing, reason: r.reason, modeled: r.modeled });
          break;
        }
      }
    }
    return out;
  }, [pool, selected, metrics]);

  const countFor = (cat: RadarCategory) =>
    pool ? pool.filter((l) => cat.test(l, metrics)).length : null;

  return (
    <section className="section-plain section" aria-labelledby="radar-heading">
      <div className="container-page">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="kicker mb-2">{t("home.radar.kicker", locale)}</p>
            <h2 id="radar-heading" className="type-h2">
              {t("home.radar.title", locale)}
            </h2>
            <p className="mt-2 text-balance text-muted-foreground">{t("home.radar.subtitle", locale)}</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-brand-strong">
            <Link to="/invest/opportunities">
              <RadarIcon className="h-4 w-4" aria-hidden /> {locale === "ar" ? "الفرص" : "Opportunities"} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>

        {/* Category chips — multi-select lenses with live counts.
            §18.3: horizontally scrollable with snap below sm (never forced
            onto one tiny line); clear selected state via brand fill. */}
        <div
          className="scroll-elegant -mx-4 flex snap-x snap-proximity gap-1.5 overflow-x-auto px-4 pb-1"
          role="group"
          aria-label="Opportunity lenses"
        >
          {CATEGORIES.map((cat) => {
            const count = countFor(cat);
            const isSelected = selected.includes(cat.key);
            return (
              <button
                key={cat.key}
                type="button"
                aria-pressed={isSelected}
                disabled={cat.disabled}
                title={cat.disabled ? t("home.radar.disabledHint", locale) : undefined}
                onClick={() => toggle(cat.key)}
                className={cn(
                  "shrink-0 snap-start rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui",
                  cat.disabled && "cursor-not-allowed border-dashed border-border/60 bg-muted/40 text-muted-foreground/50",
                  !cat.disabled && isSelected && "border-brand bg-brand text-primary-foreground",
                  !cat.disabled && !isSelected && "border-border bg-card text-foreground hover:border-brand/50 hover:bg-brand-faint"
                )}
              >
                {cat.label}
                {!cat.disabled && count !== null && (
                  <span className={cn("num ml-1.5 text-xs", isSelected ? "text-primary-foreground/75" : "text-muted-foreground")}>
                    {formatNumber(count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Reason-first listing grid */}
        <div className="mt-6">
          {matches === null ? (
            <GridSkeleton count={3} />
          ) : matches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sand/30 px-6 py-12 text-center">
              <p className="max-w-md text-balance text-sm text-muted-foreground">{t("home.radar.empty", locale)}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map(({ listing, reason, modeled }) => (
                <div key={listing.slug} className="min-w-0">
                  {/* §18.3 — "why it appears" collapses below sm (44px toggle),
                      always visible from sm up (V2 reason-first layout). */}
                  <MobileDisclosure
                    label={t("home.radar.whyShow", locale)}
                    className="mb-2"
                    contentClassName="text-xs leading-snug text-muted-foreground"
                  >
                    <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                      <span className="mt-px shrink-0 font-semibold uppercase tracking-wide text-brand-strong">
                        {t("home.radar.reason", locale)}
                      </span>
                      <span className="min-w-0 flex-1">{reason}</span>
                      {modeled && <DataStateBadge state="MODELED" />}
                    </p>
                  </MobileDisclosure>
                  <PropertyCard listing={listing} communityContext={contextFor(listing.community.slug)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {t("home.radar.benchmark", locale)} · {locale === "ar" ? "الإعلانات المعروضة من المخزون" : "Displayed listings from inventory"}: {pool === null ? "—" : formatNumber(pool.length)}
        </p>
      </div>
    </section>
  );
}

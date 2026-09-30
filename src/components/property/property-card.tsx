"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { BedDouble, Bath, Ruler, MapPin, Heart, Layers, Eye, Info, Scale, Map as MapIcon, Sparkles } from "lucide-react";
import { StatusBadge, ProvenanceBadge, DataStateBadge, UnavailableValue } from "@/components/common";
import type { ListingCardDTO } from "@/lib/types";
import type { MetricState } from "@/lib/data-state";
import { cn } from "@/lib/utils";
import { formatNumber, fromMinor, pricePerSqftMinor } from "@/lib/money";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { useSavedStore } from "@/components/providers/saved-provider";
import { PublicImage } from "@/components/public-image";

/**
 * Community-level context for the V2 evidence layer (§11.5).
 * Optional — callers without market data simply get a card without the
 * benchmark rows (progressive enhancement, never fabricated values).
 */
export interface PropertyCommunityContext {
  /** Community average asking AED/sqft (major units), when available. */
  avgPricePerSqft?: number | null;
  /** Presentation state of the benchmark figure. */
  benchmarkState?: MetricState | null;
  /** Community modeled gross yield, percent per year. */
  yieldPct?: number | null;
  /** Presentation state of the modeled yield figure. */
  yieldState?: MetricState | null;
}

export function PropertyCard({
  listing,
  compact,
  onSave,
  className,
  communityContext,
}: {
  listing: ListingCardDTO;
  compact?: boolean;
  onSave?: (slug: string) => void;
  className?: string;
  /** V2 evidence-layer context (§11.5) — optional, all rows degrade honestly. */
  communityContext?: PropertyCommunityContext;
}) {
  const saved = useSavedStore((s) => s.isFavorite(listing.slug));
  const toggleFavorite = useSavedStore((s) => s.toggleFavorite);
  const inCompare = useSavedStore((s) => s.inCompare(listing.slug));
  const toggleCompare = useSavedStore((s) => s.toggleCompare);
  const [evidenceOpen, setEvidenceOpen] = React.useState(false);

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onSave) onSave(listing.slug);
    else toggleFavorite(listing);
  };

  const handleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCompare(listing);
  };

  const beds = listing.bedrooms === 0 ? "Studio" : `${formatNumber(listing.bedrooms)}`;
  const to = `/properties/${listing.slug}`;
  const priceMajor = fromMinor(listing.price.minor);
  const priceLabel = formatAEDPrecise(priceMajor);

  /* AED/sqft — only when both price and built-up area exist (honest omission otherwise). */
  const psqftMinor = listing.areaSqft
    ? pricePerSqftMinor(BigInt(listing.price.minor), listing.areaSqft)
    : null;
  const psqft = psqftMinor !== null ? fromMinor(psqftMinor) : null;

  /* Area benchmark comparison — needs listing AED/sqft AND community average. */
  const vsAreaPct =
    psqft && communityContext?.avgPricePerSqft && communityContext.avgPricePerSqft > 0
      ? ((psqft - communityContext.avgPricePerSqft) / communityContext.avgPricePerSqft) * 100
      : null;
  const hasEvidenceLayer = !compact && Boolean(
    listing.view || psqft || communityContext?.yieldPct != null || communityContext?.avgPricePerSqft != null
  );

  return (
    <article
      className={cn(
        /* §17 property-card hover lift: 2px, pointer devices only (Tailwind v4
           hover variant is @media (hover:hover) and (pointer:fine)), and
           disabled entirely under prefers-reduced-motion via motion-safe. */
        "group relative min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card transition-ui hover:border-brand/40 motion-safe:hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(139,90,43,0.22)]",
        className
      )}
    >
      {/* Media — its own link so the evidence overlay can host interactive
          controls (never nest interactive elements inside an anchor). */}
      <div className="relative aspect-[4/3] overflow-hidden bg-sand">
        <Link
          to={to}
          aria-label={`${listing.title} — view details`}
          className="block h-full w-full focus-visible:outline-offset-[-2px]"
        >
          <PublicImage src={listing.cover?.url} alt={listing.cover?.altText || `${listing.title} in ${listing.community.name}`} width={listing.cover?.width ?? 800} height={listing.cover?.height ?? 600} className="h-full w-full object-cover zoom-media" fallback={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
              <Layers className="h-10 w-10" aria-hidden />
            </div>
          } />
        </Link>
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
          {listing.isExclusive && (
            <span className="rounded-[4px] bg-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary-foreground shadow-sm">
              Exclusive
            </span>
          )}
          {listing.isFeatured && !listing.isExclusive && (
            <span className="rounded-[4px] bg-foreground/85 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background backdrop-blur">
              Featured
            </span>
          )}
          {listing.offPlan && (
            <span className="rounded-[4px] border border-background/60 bg-background/85 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground backdrop-blur">
              Off-plan
            </span>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2">
          <StatusBadge status={listing.availabilityStatus} className="backdrop-blur" />
        </div>

        {/* V2 evidence layer (§11.5) — hover-reveal overlay on the media; the ⓘ
            button pins it open for touch/keyboard. Visibility (not opacity alone)
            keeps hidden content out of the tab order. */}
        {hasEvidenceLayer && (
          <div
            className={cn(
              "absolute inset-0 flex flex-col justify-end bg-ink/85 p-3.5 text-white backdrop-blur-[2px] transition-opacity duration-200",
              evidenceOpen
                ? "visible opacity-100"
                : "invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
            )}
          >
            <p className="type-label mb-2 text-[10px] text-white/60">Evidence</p>
            <dl className="space-y-1.5 text-[13px] leading-snug">
              {psqft && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-white/65">AED/sqft</dt>
                  <dd className="data-value text-white" title={`${formatNumber(Math.round(psqft))} AED per sqft`}>
                    {formatAEDPrecise(psqft)}
                  </dd>
                </div>
              )}
              {listing.view && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-white/65">View</dt>
                  <dd className="text-white">{listing.view.charAt(0) + listing.view.slice(1).toLowerCase()}</dd>
                </div>
              )}
              {communityContext?.yieldPct != null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-white/65">Gross yield</dt>
                  <dd className="flex items-center gap-1.5">
                    <span className="data-value text-white">{formatPctPrecise(communityContext.yieldPct, 1)}</span>
                    <DataStateBadge state={communityContext.yieldState ?? "MODELED"} />
                  </dd>
                </div>
              )}
              {vsAreaPct !== null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-white/65">vs area avg</dt>
                  <dd
                    className={cn(
                      "data-value font-semibold",
                      vsAreaPct < 0 ? "text-success" : vsAreaPct > 0 ? "text-warning" : "text-white"
                    )}
                    title={
                      communityContext?.avgPricePerSqft
                        ? `Community average ${formatAEDPrecise(communityContext.avgPricePerSqft)}/sqft`
                        : undefined
                    }
                  >
                    {vsAreaPct <= 0 ? "−" : "+"}
                    {formatPctPrecise(Math.abs(vsAreaPct), 1)}
                  </dd>
                </div>
              )}
              {communityContext && communityContext.avgPricePerSqft == null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-white/65">vs area avg</dt>
                  <dd className="text-white/60"><UnavailableValue label="Benchmark" /></dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/15 pt-2.5">
              <button
                type="button"
                onClick={handleCompare}
                aria-pressed={inCompare}
                aria-label={inCompare ? `Remove ${listing.title} from comparison` : `Add ${listing.title} to comparison`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-ui",
                  inCompare
                    ? "border-brand bg-brand text-primary-foreground"
                    : "border-white/25 bg-white/10 text-white hover:bg-white/20"
                )}
              >
                <Scale className="h-3.5 w-3.5" aria-hidden /> Compare
              </button>
              <Link
                to="/properties/map"
                query={{ community: listing.community.slug }}
                className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs text-white transition-ui hover:bg-white/20"
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden /> Map
              </Link>
              <Link
                to="/advisor"
                query={{ q: `Explain the investment case for ${listing.title} in ${listing.community.name}` }}
                className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs text-white transition-ui hover:bg-white/20"
              >
                <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden /> AI explain
              </Link>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          aria-label={saved ? `Remove ${listing.title} from saved` : `Save ${listing.title}`}
          aria-pressed={saved}
          className={cn(
            "absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/85 backdrop-blur transition-ui hover:scale-105",
            saved ? "text-brand ie-heart-pop" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Heart className={cn("h-[18px] w-[18px] transition-transform", saved && "fill-current")} aria-hidden />
        </button>

        {/* ⓘ evidence toggle — pins the hover-reveal layer open (touch/keyboard path) */}
        {hasEvidenceLayer && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEvidenceOpen((v) => !v);
            }}
            aria-expanded={evidenceOpen}
            aria-label={`${evidenceOpen ? "Hide" : "Show"} evidence details for ${listing.title}`}
            className={cn(
              "absolute bottom-1.5 right-1.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/85 backdrop-blur transition-ui hover:scale-105",
              evidenceOpen ? "text-brand" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Body */}
      <Link to={to} className="block focus-visible:outline-offset-[-2px]">
        <div className={cn("space-y-2 p-4", compact && "p-3")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className="num font-display text-xl font-semibold tracking-tight text-ink"
                title={`${priceLabel} — full asking price`}
              >
                {listing.price.qualifier ? `${listing.price.qualifier} ` : ""}
                {priceLabel}
                {listing.price.rentFrequency === "YEARLY" && <span className="ml-0.5 text-xs font-normal text-muted-foreground">/yr</span>}
                {listing.price.rentFrequency === "MONTHLY" && <span className="ml-0.5 text-xs font-normal text-muted-foreground">/mo</span>}
              </p>
              {psqft && <p className="num text-xs text-muted-foreground">{formatNumber(Math.round(psqft))} AED/sqft</p>}
              {listing.handoverQuarter && (
                <p className="text-xs font-medium text-muted-foreground">Handover {listing.handoverQuarter}</p>
              )}
            </div>
            {listing.isDemoData && <ProvenanceBadge chip={{ sourceType: "DEMO", isDemoData: true }} />}
          </div>

          <h3 className="truncate font-display text-[15px] font-medium leading-snug text-ink/90 group-hover:text-brand-strong">
            {listing.title}
          </h3>

          <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {listing.community.name}
            {listing.project ? ` · ${listing.project.name}` : ""}
          </p>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <BedDouble className="h-4 w-4" aria-hidden />
              <dt className="sr-only">Bedrooms</dt>
              <dd className="num">{beds}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Bath className="h-4 w-4" aria-hidden />
              <dt className="sr-only">Bathrooms</dt>
              <dd className="num">{formatNumber(listing.bathrooms)}</dd>
            </div>
            {listing.areaSqft ? (
              <div className="flex items-center gap-1.5">
                <Ruler className="h-4 w-4" aria-hidden />
                <dt className="sr-only">Built-up area</dt>
                <dd className="num">{formatNumber(listing.areaSqft)} sqft</dd>
              </div>
            ) : null}
            {listing.view && (
              <div className="hidden items-center gap-1.5 sm:flex">
                <Eye className="h-4 w-4" aria-hidden />
                <dt className="sr-only">View</dt>
                <dd>{listing.view.charAt(0) + listing.view.slice(1).toLowerCase()}</dd>
              </div>
            )}
          </dl>
        </div>
      </Link>
    </article>
  );
}

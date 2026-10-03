"use client";

/**
 * Hero — Intelligent Property Discovery (V2 §11.1).
 * Left: editorial copy + natural-language search that parses into editable
 * chips (SearchBar chips mode). Right (lg+): lazy Leaflet community preview
 * with layer toggles; on mobile the map is omitted but chip interactions
 * survive (spec: chips stay interactive).
 */

import * as React from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Link } from "@/lib/router";
import { SearchBar } from "@/components/search/search-bar";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, formatMoney } from "@/lib/money";
import type { CommunityCardDTO, ProjectCardDTO } from "@/lib/types";
import type { CommunityMetricSet } from "@/components/home/use-home-data";
import type { MapLayer, MiniMapCommunity } from "@/components/home/hero-mini-map";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { publicPageCopy } from "@/lib/site-settings";

const HeroMiniMap = dynamic(() => import("@/components/home/hero-mini-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-sand/60" aria-hidden />,
});

const LAYERS: { key: MapLayer; labelKey: string; caption: string }[] = [
  { key: "properties", labelKey: "home.hero.layer.properties", caption: "Listing counts per community" },
  { key: "projects", labelKey: "home.hero.layer.projects", caption: "Tracked off-plan projects per community" },
  { key: "market", labelKey: "home.hero.layer.market", caption: "Modeled avg AED/sqft per community" },
  { key: "rental", labelKey: "home.hero.layer.rental", caption: "Modeled 1BR rent per community" },
  { key: "lifestyle", labelKey: "home.hero.layer.lifestyle", caption: "Lifestyle characteristics per community" },
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const fn = (e: MediaQueryListEvent) => setMatches(e.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return matches;
}

export function Hero({
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
  const [activeLayer, setActiveLayer] = React.useState<MapLayer>("properties");
  const settings = useSiteSettings();
  const [selectedCommunity, setSelectedCommunity] = React.useState<string | null>(null);
  const mapPanelRef = React.useRef<HTMLDivElement>(null);
  const [mapVisible, setMapVisible] = React.useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  /* Load the Leaflet bundle only when the panel is near the viewport. */
  React.useEffect(() => {
    const el = mapPanelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMapVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMapVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const miniMapCommunities: MiniMapCommunity[] = React.useMemo(() => {
    if (!communities) return [];
    const projectCounts = new Map<string, number>();
    for (const p of projects ?? []) {
      projectCounts.set(p.community.slug, (projectCounts.get(p.community.slug) ?? 0) + 1);
    }
    return communities.map((c) => ({
      slug: c.slug,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      listingCount: c.listingCount ?? 0,
      projectsCount: projectCounts.get(c.slug) ?? 0,
      avgPricePerSqft: communityMetrics?.[c.slug]?.avgPricePerSqft,
      avgRent1Br: communityMetrics?.[c.slug]?.avgRent1Br,
      yieldPct: communityMetrics?.[c.slug]?.yieldPct,
      lifestyleTags: c.lifestyleTags,
    }));
  }, [communities, communityMetrics, projects]);

  const selected = communities?.find((c) => c.slug === selectedCommunity) ?? null;
  const selectedMetrics = selectedCommunity ? communityMetrics?.[selectedCommunity] : undefined;
  const activeLayerCaption = LAYERS.find((l) => l.key === activeLayer)?.caption;

  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-heading">
      <div className="absolute inset-0">
        <Image
          src="/images/brand/hero-skyline.jpg"
          alt="Dubai skyline at dusk across the water"
          fill
          sizes="100vw"
          quality={60}
          loading="eager"
          fetchPriority="high"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/92 via-ink/62 to-ink/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/45 via-ink/10 to-transparent" />
      </div>

      <div className="container-page relative py-16 sm:py-20 lg:py-24">
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Editorial left column */}
          <div className="min-w-0 lg:col-span-7">
            <p className="type-label text-white/70">{publicPageCopy(settings, "homeEyebrow", locale, t("home.hero.eyebrow", locale))}</p>
            <h1
              id="hero-heading"
              className="type-display-hero mt-4 max-w-2xl text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]"
            >
              {publicPageCopy(settings, "homeTitle", locale, t("home.hero.title", locale))}{" "}
              <span className="text-brand-hero">{publicPageCopy(settings, "homeAccent", locale, t("home.hero.titleAccent", locale))}</span>
            </h1>
            <p className="type-body-lg mt-5 max-w-xl text-balance text-white/85 drop-shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
              {publicPageCopy(settings, "homeIntro", locale, t("home.hero.subtitle", locale))}
            </p>

            <div className="mt-8 max-w-2xl">
              <SearchBar
                listingType="SALE"
                chips
                eventContext="hero"
                placeholder={t("home.hero.searchPlaceholder", locale)}
                submitLabel={t("home.hero.searchCta", locale)}
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
              >
                <Link to="/advisor">
                  <Sparkles className="h-4 w-4" aria-hidden /> {t("home.hero.askAi", locale)}
                </Link>
              </Button>
              <Link
                to="/properties"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-white/80 underline-offset-4 transition-ui hover:text-white hover:underline"
              >
                {t("home.hero.advanced", locale)} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              </Link>
            </div>
          </div>

          {/* Spatial right column — map on desktop, chips everywhere */}
          <div className="min-w-0 lg:col-span-5">
            <div
              ref={mapPanelRef}
              className="hidden overflow-hidden rounded-xl border border-white/20 bg-card shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)] lg:block"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
                <p className="type-label text-muted-foreground">{t("home.hero.mapLabel", locale)}</p>
                <span className="sr-only">{t("home.hero.mapPreview", locale)}</span>
              </div>
              <div className="relative h-[300px] xl:h-[340px]">
                {mapVisible && isDesktop ? (
                  <HeroMiniMap
                    communities={miniMapCommunities}
                    selectedSlug={selectedCommunity}
                    onSelect={setSelectedCommunity}
                    activeLayer={activeLayer}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-sand/60 text-muted-foreground">
                    <MapPin className="h-6 w-6 opacity-50" aria-hidden />
                  </div>
                )}
              </div>
            </div>

            {/* Community chips — synced with map markers; visible on mobile too. */}
            <div className="scroll-elegant -mx-4 mt-0 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-3 lg:px-0">
              {(communities ?? []).map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  aria-pressed={selectedCommunity === c.slug}
                  onClick={() => setSelectedCommunity(selectedCommunity === c.slug ? null : c.slug)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-ui",
                    selectedCommunity === c.slug
                      ? "border-brand bg-brand text-primary-foreground"
                      : "border-white/25 bg-white/10 text-white/90 backdrop-blur hover:bg-white/20 lg:border-border/70 lg:bg-secondary lg:text-foreground lg:hover:bg-secondary/70"
                  )}
                >
                  {c.name}
                </button>
              ))}
              {communities === null && (
                <span className="text-xs text-white/60 lg:text-muted-foreground">Loading communities…</span>
              )}
            </div>

            {/* Selected community context line */}
            {selected && (
              <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75 lg:text-muted-foreground">
                <span className="font-semibold text-white lg:text-foreground">{selected.name}</span>
                <span className="num">{formatNumber(selected.listingCount ?? 0)} listings</span>
                {selectedMetrics?.avgPricePerSqft && (
                  <span className="num">
                    {formatMoney(String(Math.round(selectedMetrics.avgPricePerSqft * 100)), { currency: "AED", compact: true })}/sqft
                  </span>
                )}
                {selectedMetrics?.yieldPct != null && <span className="num">{selectedMetrics.yieldPct.toFixed(1)}% modeled yield</span>}
                <Link to={`/communities/${selected.slug}`} className="font-medium text-brand-hero underline-offset-2 hover:underline lg:text-brand-strong">
                  Community profile →
                </Link>
              </p>
            )}

            {/* Layer toggles — visual preview state with honest captions.
                Desktop map only: below lg the map panel is omitted (§18.1 mobile
                stack) so the layer controls are hidden to avoid dead UI. */}
            <div className="mt-4 hidden lg:block">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Map preview layers">
                {LAYERS.map((layer) => (
                  <button
                    key={layer.key}
                    type="button"
                    aria-pressed={activeLayer === layer.key}
                    onClick={() => setActiveLayer(layer.key)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-ui",
                      activeLayer === layer.key
                        ? "border-brand/60 bg-brand-faint text-brand-strong"
                        : "border-white/25 bg-white/5 text-white/70 backdrop-blur hover:bg-white/15 lg:border-border/70 lg:text-muted-foreground lg:hover:bg-secondary"
                    )}
                  >
                    {t(layer.labelKey, locale)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/60 lg:text-muted-foreground" aria-live="polite">
                {activeLayerCaption} · {t("home.hero.mapPreview", locale)}
              </p>
            </div>

            {/* Mobile: compact path into the full map (§18.1 stack item 7 —
                "Open map" replaces the omitted map preview). */}
            <div className="mt-5 lg:hidden">
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full rounded-full border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
              >
                <Link to="/properties/map">
                  <MapPin className="h-4 w-4" aria-hidden /> {t("home.hero.openMap", locale)}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

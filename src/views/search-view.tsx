"use client";

/**
 * Search & Result Discovery V2 (U04, V2 §12).
 *
 * - §12.1 modes: Buy / Rent / Off-Plan / Projects (URL `?mode=…`, ARIA tablist).
 * - §12.3 advanced filters in the shared FilterPanel (desktop sidebar / mobile sheet).
 * - §12.4 desktop: list left + synchronized embedded map right (URL `?view=list|split|map`),
 *   sticky toolbar (mode tabs, sort, layout toggle, result count), compare tray.
 * - §12.5 mobile: card list, floating map button → full-screen sheet, sticky controls.
 * - §12.6 smart filters with documented methodology.
 * - State completeness: loading / empty-with-recovery / error / degraded.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { Link, navigate, useRoute } from "@/lib/router";
import { api, qs, ApiError } from "@/lib/api-client";
import { PropertyCard } from "@/components/property/property-card";
import { SearchBar } from "@/components/search/search-bar";
import { SearchModeTabs, type SearchMode } from "@/components/search/mode-tabs";
import { SmartFilterChips, activeSmartKeys, type SmartKey } from "@/components/search/smart-filters";
import { FilterPanel, type SearchFacetsExt } from "@/components/search/filter-panel";
import { ProjectResultCard, type ProjectResultDTO } from "@/components/search/project-result-card";
import type { MapMarkerItem } from "@/components/search/results-map";
import { usePageMeta } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, GridSkeleton, UnavailableValue } from "@/components/common";
import { RecentlyViewedStrip } from "@/components/common/recently-viewed";
import { useSavedStore } from "@/components/providers/saved-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { events } from "@/lib/analytics-tracker";
import { formatNumber, fromMinor } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { localeOf, t } from "@/lib/i18n";
import type { SearchResponse, ListingCardDTO } from "@/lib/types";
import {
  SlidersHorizontal, Map as MapIcon, List, LayoutPanelLeft, BookmarkPlus, ChevronLeft, ChevronRight,
  Loader2, MapPin, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Leaflet only where a map is actually shown (platform lazy budget). */
const ResultsMap = dynamic(() => import("@/components/search/results-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-sand/60" aria-hidden />,
});

type ViewMode = "list" | "split" | "map";

type SearchResponseExt = SearchResponse & {
  facets: SearchResponse["facets"] & { views?: { key: string; count: number }[] };
};

const LISTING_SORTS = [
  { key: "relevance", labelKey: "search.sort.relevance" },
  { key: "price_asc", labelKey: "search.sort.priceAsc" },
  { key: "price_desc", labelKey: "search.sort.priceDesc" },
  { key: "newest", labelKey: "search.sort.newest" },
  { key: "area_desc", labelKey: "search.sort.areaDesc" },
  { key: "price_per_sqft_asc", labelKey: "search.sort.ppsf" },
  { key: "yield_desc", labelKey: "search.sort.yield" },
];

const PROJECT_SORTS = [
  { key: "relevance", labelKey: "search.sort.relevance" },
  { key: "price_asc", labelKey: "search.sort.priceAsc" },
  { key: "price_desc", labelKey: "search.sort.priceDesc" },
  { key: "handover_asc", labelKey: "search.project.handover" },
];

/** Derive the canonical mode from `mode` with legacy `type`/`offPlan` fallbacks. */
function deriveMode(query: Record<string, string>): SearchMode {
  if (query.mode === "rent" || query.type === "rent") return "rent";
  if (query.mode === "offplan" || query.offPlan === "1") return "offplan";
  if (query.mode === "projects") return "projects";
  return "buy";
}

function handoverQuarterLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export default function SearchView() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const { user } = useAuth();
  const { toast } = useToast();

  const mode = deriveMode(loc.query);
  const isProjects = mode === "projects";
  const isRent = mode === "rent";
  const page = Math.max(1, Number(loc.query.page ?? 1));

  /* Layout: URL `view` param; defaults split on lg+, list on mobile. */
  const [isLg, setIsLg] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLg(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const viewParam = (["list", "split", "map"] as const).includes(loc.query.view as ViewMode)
    ? (loc.query.view as ViewMode)
    : undefined;
  const effectiveView: ViewMode = viewParam ?? (isLg ? "split" : "list");
  const mapVisible = effectiveView === "split" || effectiveView === "map";

  /* ------------------------------ data ------------------------------- */
  const [data, setData] = React.useState<SearchResponseExt | null>(null);
  const [projectsData, setProjectsData] = React.useState<{ total: number; projects: ProjectResultDTO[] } | null>(null);
  const [communitiesForProjects, setCommunitiesForProjects] = React.useState<{ id: string; name: string; slug: string }[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  /* Retry nonce — navigating to the same URL would not re-run the fetch
     effect (identical query string), so the error-state retry bumps this. */
  const [retryTick, setRetryTick] = React.useState(0);

  // Query string driving the fetch (mode is understood by the API additively).
  const queryStr = qs({ ...loc.query, type: loc.query.type });

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (isProjects) {
      const params = qs({
        q: loc.query.q,
        community: loc.query.community,
        handoverFrom: loc.query.handoverFrom,
        handoverTo: loc.query.handoverTo,
        limit: 48,
      });
      api
        .get<{ total: number; projects: ProjectResultDTO[] }>(`/api/projects${params}`)
        .then((res) => {
          if (cancelled) return;
          setProjectsData({ total: res.total ?? res.projects.length, projects: res.projects ?? [] });
          events.searchSubmitted("projects", res.total ?? res.projects.length);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Search is temporarily unavailable.");
        })
        .finally(() => !cancelled && setLoading(false));
    } else {
      api
        .get<SearchResponseExt>(`/api/search${queryStr}`)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          events.searchSubmitted(mode, res.total);
          if (loc.query.q) events.search({ q: loc.query.q, results: res.total });
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Search is temporarily unavailable.");
        })
        .finally(() => !cancelled && setLoading(false));
    }
    return () => {
      cancelled = true;
    };
  }, [queryStr, isProjects, mode, retryTick]);

  // Community list for the Projects-mode filter panel (no search facets there).
  React.useEffect(() => {
    if (!isProjects || communitiesForProjects) return;
    api
      .get<{ communities: { id: string; name: string; slug: string }[] }>("/api/communities")
      .then((r) => setCommunitiesForProjects(r.communities))
      .catch(() => setCommunitiesForProjects([]));
  }, [isProjects, communitiesForProjects]);

  /* --------------------------- map / hover sync --------------------- */
  const [hoveredSlug, setHoveredSlug] = React.useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [mobileMapOpen, setMobileMapOpen] = React.useState(false);
  const mapOpenedRef = React.useRef(false);
  const fireMapOpened = (context: string) => {
    if (mapOpenedRef.current) return;
    mapOpenedRef.current = true;
    events.mapOpened(context);
  };
  React.useEffect(() => {
    if (mapVisible) fireMapOpened(effectiveView === "map" ? "search-map-view" : "search-split");
  }, [mapVisible, effectiveView]);

  const listingResults = data?.results ?? [];
  const projects = React.useMemo(() => {
    if (!projectsData) return [];
    const arr = [...projectsData.projects];
    switch (loc.query.sort) {
      case "price_asc":
        return arr.sort((a, b) => (a.startingPrice ? Number(a.startingPrice.minor) : Infinity) - (b.startingPrice ? Number(b.startingPrice.minor) : Infinity));
      case "price_desc":
        return arr.sort((a, b) => (b.startingPrice ? Number(b.startingPrice.minor) : -1) - (a.startingPrice ? Number(a.startingPrice.minor) : -1));
      case "handover_asc":
        return arr.sort((a, b) => (a.handoverDate ? Date.parse(a.handoverDate) : Infinity) - (b.handoverDate ? Date.parse(b.handoverDate) : Infinity));
      default:
        return arr;
    }
  }, [projectsData, loc.query.sort]);

  const mapItems: MapMarkerItem[] = React.useMemo(() => {
    if (isProjects) {
      return projects
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => ({
          kind: "project" as const,
          slug: p.slug,
          lat: p.lat as number,
          lng: p.lng as number,
          label: p.startingPrice ? formatAEDPrecise(fromMinor(p.startingPrice.minor)) : "—",
          title: p.name,
          sublabel: `${p.community.name} · ${p.developer.name}`,
        }));
    }
    return listingResults
      .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
      .map((l) => ({
        kind: "property" as const,
        slug: l.slug,
        lat: l.lat,
        lng: l.lng,
        label: formatAEDPrecise(fromMinor(l.price.minor)),
        title: l.title,
        sublabel: `${l.community.name}${isRent ? " · rent" : ""}`,
      }));
  }, [isProjects, projects, listingResults, isRent]);

  const selectedListing = listingResults.find((l) => l.slug === selectedSlug) ?? null;
  const selectedProject = isProjects ? projects.find((p) => p.slug === selectedSlug) ?? null : null;

  const onMarkerSelect = (item: MapMarkerItem) => {
    setSelectedSlug(item.slug);
    if (effectiveView !== "map") {
      document.getElementById(`result-${item.slug}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  /* ------------------------------ URL state -------------------------- */
  const setParam = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next: Record<string, string> = { ...loc.query };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") delete next[k];
      else next[k] = v;
    }
    if (resetPage) delete next.page;
    events.filter(patch);
    navigate("/properties", next);
  };

  const setMode = (m: SearchMode) => {
    const next: Record<string, string> = { ...loc.query };
    delete next.type;
    delete next.offPlan;
    delete next.page;
    delete next.nl;
    if (m === "buy") delete next.mode;
    else next.mode = m;
    events.searchModeChanged(m);
    navigate("/properties", next);
  };

  const setView = (v: ViewMode) => {
    const natural = isLg ? "split" : "list";
    setParam({ view: v === natural ? undefined : v }, false);
  };

  const toggleSmart = (key: SmartKey) => {
    const current = activeSmartKeys(loc.query.smart);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setParam({ smart: next.join(",") || undefined });
  };

  const clearAllFilters = () => navigate("/properties", mode === "buy" ? {} : { mode: isProjects ? "projects" : isRent ? "rent" : "offplan" });

  /* ------------------------------ save search ------------------------ */
  const saveSearch = async () => {
    if (!user) {
      navigate("/account/login");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ id: string; currentMatches: number }>("/api/saved-searches", {
        name: loc.query.q ? `"${loc.query.q}"` : undefined,
        searchState: { ...loc.query, mode },
        alertConsent: true,
        alertFrequency: "WEEKLY",
      });
      toast({
        title: t("search.saved", locale),
        description: t("search.savedDesc", locale).replace("{n}", formatNumber(res.currentMatches)),
      });
    } catch (err) {
      toast({ title: t("search.saveFailed", locale), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ compare ---------------------------- */
  const compareItems = useSavedStore((s) => s.compare);
  const toggleCompare = useSavedStore((s) => s.toggleCompare);
  const clearCompare = useSavedStore((s) => s.clearCompare);

  /* ------------------------------ meta ------------------------------- */
  const headingKey =
    mode === "rent" ? "search.mode.rent.heading" : mode === "offplan" ? "search.mode.offplan.heading" : mode === "projects" ? "search.mode.projects.heading" : "search.mode.buy.heading";
  usePageMeta({
    title: `${t(headingKey, locale)} — Search`,
    description: isRent
      ? "Search rental apartments, villas and townhouses across Dubai communities with transparent filters and map view."
      : isProjects
      ? "Browse Dubai new-build projects — developer, entry price, handover and construction status, filterable and mapped."
      : "Search homes and investment properties across Dubai — filter by community, price, bedrooms, off-plan and payment plans.",
    noindex: !!loc.query.q || Object.keys(loc.query).length > 3, // internal search states noindex (F10)
  });

  const total = isProjects ? projectsData?.total ?? 0 : data?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const facets: SearchFacetsExt | undefined = isProjects ? undefined : data?.facets;
  const sortOptions = isProjects ? PROJECT_SORTS : LISTING_SORTS;

  /* --------------------- no-results recovery (F09) ------------------- */
  const relaxationSuggestions: { label: string; action: () => void }[] = [];
  if (isProjects) {
    if (loc.query.q) relaxationSuggestions.push({ label: t("search.empty.projects", locale), action: () => setParam({ q: undefined }) });
    if (loc.query.community) relaxationSuggestions.push({ label: t("search.empty.removeCommunity", locale), action: () => setParam({ community: undefined }) });
  } else {
    if (loc.query.priceMax || loc.query.priceMin) {
      relaxationSuggestions.push({
        label: t("search.empty.removePrice", locale),
        action: () => setParam({ priceMin: undefined, priceMax: undefined }),
      });
      relaxationSuggestions.push({
        label: t("search.empty.widenPrice", locale),
        action: () => {
          const min = Number(loc.query.priceMin || 0) || null;
          const max = Number(loc.query.priceMax || 0) || null;
          /* 5K grid with floor/ceil so the widened bounds always move by at
             least ±20% (a 50K round grid can no-op on small values). */
          setParam({
            priceMin: min ? String(Math.max(0, Math.floor((min * 0.8) / 5_000) * 5_000)) : undefined,
            priceMax: max ? String(Math.ceil((max * 1.2) / 5_000) * 5_000) : undefined,
          });
        },
      });
    }
    if (loc.query.community) relaxationSuggestions.push({ label: t("search.empty.removeCommunity", locale), action: () => setParam({ community: undefined }) });
    if (loc.query.bedsMin) relaxationSuggestions.push({ label: t("search.empty.resetBeds", locale), action: () => setParam({ bedsMin: undefined }) });
    if (loc.query.smart) relaxationSuggestions.push({ label: t("search.empty.removeSmart", locale), action: () => setParam({ smart: undefined }) });
    if (loc.query.amenities) relaxationSuggestions.push({ label: t("search.empty.removeAmenities", locale), action: () => setParam({ amenities: undefined }) });
    if (loc.query.views) relaxationSuggestions.push({ label: t("search.empty.removeView", locale), action: () => setParam({ views: undefined }) });
    if (loc.query.furnishing) relaxationSuggestions.push({ label: t("search.empty.removeFurnishing", locale), action: () => setParam({ furnishing: undefined }) });
  }

  const activeFilterNames = [
    loc.query.q && `"${loc.query.q}"`,
    loc.query.community && t("search.filters.community", locale),
    loc.query.priceMax && isRent ? t("search.empty.rentCap", locale) : t("search.empty.priceCap", locale),
    loc.query.bedsMin && t("search.filters.bedrooms", locale),
    loc.query.smart && t("search.filters.smart", locale),
    loc.query.amenities && t("search.filters.amenities", locale),
    loc.query.views && t("search.filters.view", locale),
    loc.query.furnishing && t("search.filters.furnishing", locale),
    loc.query.ppsfMax && t("search.filters.ppsf", locale),
    loc.query.yieldMin && t("search.filters.yield", locale),
  ].filter(Boolean) as string[];

  /* ------------------------------ render ----------------------------- */
  const panel = (
    <FilterPanel
      locale={locale}
      mode={mode}
      query={loc.query}
      facets={facets}
      communitiesForProjects={communitiesForProjects ?? undefined}
      setParam={setParam}
      onClearAll={clearAllFilters}
    />
  );

  const mapPreviewOverlay = (selectedListing || selectedProject) && (
    <div className="absolute inset-x-3 bottom-3 z-[500] mx-auto max-w-sm">
      <div className="relative rounded-xl border border-border bg-card shadow-xl">
        <button
          type="button"
          onClick={() => setSelectedSlug(null)}
          aria-label={t("map.preview.close", locale)}
          className="absolute right-2 top-2 z-10 rounded-full bg-background/90 p-1.5 text-muted-foreground backdrop-blur transition-ui hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        {selectedListing ? (
          <PropertyCard listing={selectedListing} compact />
        ) : selectedProject ? (
          <div className="p-4">
            <p className="kicker">{selectedProject.developer.name}</p>
            <p className="mt-1 font-display text-base font-semibold leading-snug">{selectedProject.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{selectedProject.community.name}</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="num text-sm font-semibold">
                {selectedProject.startingPrice
                  ? `${t("search.project.cardFrom", locale)} ${formatAEDPrecise(fromMinor(selectedProject.startingPrice.minor))}`
                  : <UnavailableValue />}
              </p>
              {selectedProject.handoverDate && (
                <p className="text-xs text-muted-foreground">
                  {t("search.project.handover", locale)} {handoverQuarterLabel(selectedProject.handoverDate)}
                </p>
              )}
            </div>
            <Button asChild size="sm" className="mt-3 w-full">
              <Link to={`/projects/${selectedProject.slug}`}>{t("search.project.viewProject", locale)}</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  /* sr-only map description — marker counts are mode-accurate (listing markers
     in listing modes, project markers in projects mode); the viewport values
     are the map's default Dubai center until the user pans. */
  const srMapText = t("map.sr.viewport", locale)
    .replace("{n}", formatNumber(isProjects ? 0 : mapItems.length))
    .replace("{m}", formatNumber(isProjects ? mapItems.length : 0))
    .replace("{lat}", "25.1")
    .replace("{lng}", "55.2")
    .replace("{z}", "11");

  const resultsGridClass = mapVisible ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="container-page py-4 pb-24 sm:py-6 lg:pb-8">
      {/* Heading + search bar */}
      <div className="mb-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {t(headingKey, locale)}
              {loc.query.q && <span className="text-muted-foreground"> · “{loc.query.q}”</span>}
            </h1>
            {(data || projectsData) && (
              <p className="num mt-1 text-sm text-muted-foreground">
                {formatNumber(total)} {total === 1 ? t("search.result", locale) : t("search.results", locale)}
                {data?.tookMs ? <span className="ml-2 text-muted-foreground/60">({data.tookMs}ms)</span> : null}
                {data?.degraded && (
                  <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                    {t("search.degraded", locale)}
                  </span>
                )}
              </p>
            )}
            {data?.degraded && <p className="mt-1 text-xs text-muted-foreground">{t("search.degradedNote", locale)}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/properties/map" query={{ ...loc.query, mode: isProjects ? undefined : mode === "buy" ? undefined : mode }}>
                <MapIcon className="h-4 w-4" aria-hidden /> {t("search.view.map", locale)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={saveSearch} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BookmarkPlus className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">{t("search.saveSearch", locale)}</span>
            </Button>
          </div>
        </div>
        <SearchBar listingType={isRent ? "RENT" : "SALE"} size="md" mode={mode} />
      </div>

      {/* Sticky toolbar: mode tabs + sort + layout toggle (§12.4) */}
      <div className="sticky top-[65px] z-30 mb-5 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="max-w-full overflow-x-auto scroll-elegant">
            <SearchModeTabs mode={mode} onModeChange={setMode} locale={locale} size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="sort" className="hidden text-sm text-muted-foreground sm:inline">
                {t("search.sort.label", locale)}
              </label>
              <Select
                value={loc.query.sort ?? "relevance"}
                onValueChange={(v) => setParam({ sort: v === "relevance" ? undefined : v }, false)}
              >
                <SelectTrigger id="sort" className="min-h-11 w-40 sm:min-h-0 sm:w-48" aria-label={t("search.sort.label", locale)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {t(s.labelKey, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Layout toggle (lg+) */}
            <div className="hidden items-center gap-1 rounded-full border border-border bg-background p-1 lg:flex" role="group" aria-label={t("search.view.label", locale)}>
              {([
                { v: "list", icon: List, key: "search.view.list" },
                { v: "split", icon: LayoutPanelLeft, key: "search.view.split" },
                { v: "map", icon: MapIcon, key: "search.view.map" },
              ] as const).map(({ v, icon: Icon, key }) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={effectiveView === v}
                  aria-label={t(key, locale)}
                  title={t(key, locale)}
                  onClick={() => setView(v)}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-full transition-ui",
                    effectiveView === v ? "bg-brand text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </button>
              ))}
            </div>
            {/* Filters (mobile + lg split where sidebar hidden) */}
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-11 gap-1.5 sm:h-9 xl:hidden">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  <span className="hidden xs:inline sm:inline">{t("search.filters", locale)}</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
                <SheetHeader className="pb-2 text-left">
                  <SheetTitle>{t("search.filters", locale)}</SheetTitle>
                </SheetHeader>
                {panel}
                <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-background/95 p-4 backdrop-blur">
                  <Button className="w-full" onClick={() => setFiltersOpen(false)}>
                    {t("search.filters.showResults", locale)}
                    {total ? ` (${formatNumber(total)})` : ""}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      {/* DEV-C — dismissible recently-viewed strip (session-scoped; above the results grid) */}
      <RecentlyViewedStrip locale={locale} />

      <div className="flex gap-6">
        {/* Desktop filter sidebar (xl+; hidden at lg when the map column takes the space) */}
        <aside aria-label="Search filters" className="hidden w-60 shrink-0 xl:block">
          <div className="sticky top-[7.75rem] max-h-[calc(100vh-9.5rem)] overflow-y-auto scroll-elegant pr-2">
            <h2 className="kicker mb-3">{t("search.filters", locale)}</h2>
            {panel}
          </div>
        </aside>

        {/* Results column */}
        <div className="min-w-0 flex-1">
          {/* Smart filter chips (§12.6) */}
          {!isProjects && (
            <div className="mb-4 space-y-1.5">
              <SmartFilterChips smartParam={loc.query.smart} onToggle={toggleSmart} locale={locale} mode={mode} />
              {mapVisible && <p className="text-xs text-muted-foreground">{t("search.map.syncHint", locale)}</p>}
            </div>
          )}

          {/* Map view (desktop full-column map) */}
          {effectiveView === "map" && (
            <div className="relative mb-6 h-[calc(100vh-13rem)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-sand/40">
              <ResultsMap
                items={mapItems}
                hoveredSlug={hoveredSlug}
                selectedSlug={selectedSlug}
                onSelect={onMarkerSelect}
                locale={locale}
                srViewport={srMapText}
              />
              {mapPreviewOverlay}
            </div>
          )}

          {/* States */}
          {loading ? (
            <GridSkeleton count={mapVisible ? 4 : 6} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => setRetryTick((n) => n + 1)} />
          ) : total === 0 ? (
            <div className="space-y-4">
              <EmptyState
                title={t("search.empty.title", locale)}
                description={
                  activeFilterNames.length
                    ? t("search.empty.try", locale).replace("{filters}", activeFilterNames.slice(0, 3).join(", "))
                    : isProjects
                    ? t("search.empty.projects", locale)
                    : t("search.empty.try", locale).replace("{filters} ", "")
                }
              />
              {relaxationSuggestions.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4" role="group" aria-label={t("search.empty.relax", locale)}>
                  <p className="kicker mb-2.5">{t("search.empty.relax", locale)}</p>
                  <div className="flex flex-wrap gap-2">
                    {relaxationSuggestions.slice(0, 6).map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={r.action}
                        className="rounded-full border border-brand/40 bg-brand-faint px-3 py-1.5 text-sm font-medium text-brand-strong transition-ui hover:border-brand/70 hover:bg-brand-soft"
                      >
                        {r.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-ui hover:text-foreground"
                    >
                      {t("search.empty.clearAll", locale)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : isProjects ? (
            <div className={cn("grid gap-5", resultsGridClass)}>
              {projects.map((p) => (
                <ProjectResultCard key={p.id} project={p} locale={locale} id={`result-${p.slug}`} onHover={setHoveredSlug} />
              ))}
            </div>
          ) : (
            <>
              <div className={cn("grid gap-5", resultsGridClass)}>
                {listingResults.map((l) => (
                  <div
                    key={l.id}
                    id={`result-${l.slug}`}
                    onMouseEnter={() => setHoveredSlug(l.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                    className={cn(
                      "relative min-w-0 rounded-lg ring-brand transition-shadow",
                      selectedSlug === l.slug && "ring-2"
                    )}
                  >
                    <PropertyCard listing={l} />
                    <button
                      type="button"
                      onClick={() => toggleCompare(l)}
                      aria-pressed={compareItems.some((c) => c.slug === l.slug)}
                      className={cn(
                        "absolute bottom-3 right-3 z-10 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold backdrop-blur transition-ui",
                        compareItems.some((c) => c.slug === l.slug)
                          ? "border-brand text-brand-strong"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {compareItems.some((c) => c.slug === l.slug)
                        ? `✓ ${t("search.compare.comparing", locale)}`
                        : t("common.compare", locale)}
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination (crawl-safe, URL-synchronized) */}
              {totalPages > 1 && (
                <nav aria-label={t("search.pagination.label", locale)} className="mt-10 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setParam({ page: page > 1 ? String(page - 1) : undefined }, false)}
                    aria-label={t("search.pagination.prev", locale)}
                  >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                  {Array.from({ length: Math.min(7, totalPages) }).map((_, i) => {
                    const p = page <= 4 ? i + 1 : page + i - 3;
                    if (p > totalPages) return null;
                    return (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="sm"
                        aria-current={p === page ? "page" : undefined}
                        onClick={() => setParam({ page: p === 1 ? undefined : String(p) }, false)}
                        className="num min-w-9"
                      >
                        {p}
                      </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setParam({ page: String(page + 1) }, false)}
                    aria-label={t("search.pagination.next", locale)}
                  >
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>

        {/* Split-view synchronized map (lg+) */}
        {effectiveView === "split" && (
          <div className="hidden w-[360px] shrink-0 lg:block xl:w-[420px]">
            <div className="sticky top-[7.75rem] h-[calc(100vh-9.5rem)] overflow-hidden rounded-xl border border-border bg-sand/40">
              <ResultsMap
                items={mapItems}
                hoveredSlug={hoveredSlug}
                selectedSlug={selectedSlug}
                onSelect={onMarkerSelect}
                locale={locale}
                srViewport={srMapText}
              />
              {mapPreviewOverlay}
            </div>
          </div>
        )}
      </div>

      {/* Mobile floating map button (§12.5) — above the global tab bar (and the
          compact compare pill when one is open); 44px touch target. */}
      {!mobileMapOpen && (
        <button
          type="button"
          onClick={() => {
            setMobileMapOpen(true);
            fireMapOpened("search-mobile-sheet");
          }}
          className={cn(
            "fixed end-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-primary-foreground shadow-xl transition-ui hover:scale-105 lg:hidden",
            compareItems.length > 0
              ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))]"
              : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
          )}
          aria-label={t("search.view.openMap", locale)}
        >
          <MapPin className="h-4 w-4" aria-hidden />
          {t("search.view.openMap", locale)}
          <span className="num rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{formatNumber(total)}</span>
        </button>
      )}

      {/* Mobile full-screen map sheet */}
      <Sheet open={mobileMapOpen} onOpenChange={setMobileMapOpen}>
        <SheetContent
          side="bottom"
          className="h-[92vh] overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <SheetHeader className="px-4 pt-4 text-left">
            <SheetTitle className="flex items-center justify-between gap-3">
              <span>
                {t("search.view.map", locale)}
                <span className="num ml-2 text-sm font-normal text-muted-foreground">
                  {formatNumber(total)} {t("search.map.inView", locale)}
                </span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="relative h-[calc(92vh-4.5rem)]">
            <ResultsMap
              items={mapItems}
              hoveredSlug={hoveredSlug}
              selectedSlug={selectedSlug}
              onSelect={(item) => setSelectedSlug(item.slug)}
              locale={locale}
              srViewport={srMapText}
            />
            {mapPreviewOverlay}
          </div>
        </SheetContent>
      </Sheet>

      {/* Compare tray — §21 mobile: compact centered pill (count + compare +
          clear) above the global tab bar; lg+: full-width V2 bar with chips. */}
      {compareItems.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 lg:bottom-0"
          role="region"
          aria-label={t("search.compare.tray", locale)}
        >
          <div className="container-page max-lg:py-1.5 lg:border-t lg:border-border lg:bg-background/97 lg:shadow-lg lg:backdrop-blur">
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-background/97 px-2 py-1.5 shadow-lg backdrop-blur lg:w-full lg:gap-4 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:py-3 lg:shadow-none lg:backdrop-blur-none">
              <div className="hidden min-w-0 flex-1 items-center gap-3 overflow-x-auto scroll-elegant lg:flex">
                {compareItems.map((c) => (
                  <div key={c.slug} className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-sand/50 px-3 py-1.5 text-sm">
                    <span className="max-w-40 truncate font-medium">{c.title}</span>
                    <button
                      type="button"
                      aria-label={t("search.compare.remove", locale).replace("{title}", c.title)}
                      onClick={() => toggleCompare(c)}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground lg:h-auto lg:w-auto"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {compareItems.length}/{t("search.compare.max", locale)}
                </span>
              </div>
              {/* Compact mobile summary (chips hidden — pill stays one line at 320px) */}
              <span className="num whitespace-nowrap text-sm font-semibold lg:hidden">
                {formatNumber(compareItems.length)}/{t("search.compare.max", locale)}
              </span>
              <Button asChild size="sm" className="h-11 shrink-0 rounded-full lg:h-8">
                <Link to="/compare">{t("search.compare.now", locale)}</Link>
              </Button>
              <button
                type="button"
                aria-label={t("search.compare.clear", locale)}
                onClick={clearCompare}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground lg:hidden"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
              <Button variant="ghost" size="sm" className="hidden shrink-0 lg:inline-flex" onClick={clearCompare}>
                {t("search.compare.clear", locale)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

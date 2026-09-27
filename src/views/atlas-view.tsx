"use client";

/**
 * Dubai Investment Atlas (U17 — V2 §29).
 *
 * 2D/3D dual-mode city-scale investment view:
 *  - Default 2D (§28 "2D for analysis"): Leaflet community-level analytical
 *    map (U05-style layers + value-sized community circles).
 *  - 3D spatial view (§29.3): lazy Three.js scene (community metric
 *    extrusions at real coordinates, project point markers, illustrative
 *    coastline) — loaded ONLY when the user switches to 3D AND the viewport
 *    is visible (React.lazy + IntersectionObserver, §30.3).
 *  - Right control panel (§29.4): metric picker (disabled when no data),
 *    sale/rent side, layer chips, read-only data-coverage range, locate
 *    community (flyTo), reset view, performance-mode switch.
 *  - Selection (§29.5): community/project info panel overlays the viewport —
 *    scene state is never lost. Every metric carries a DataStateBadge.
 *  - URL state (§29.6): ?mode=&metric=&community=&side= shareable; route is
 *    noindex (search state, no index bloat).
 *  - Fallback chain: WebGL missing/failing → 2D mode + one-time toast; metric
 *    without data → disabled option with tooltip; full data table below the
 *    viewport is the accessible DOM alternative (§30.4/§43).
 */

import * as React from "react";
import { Link, navigate, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { LoadingState } from "@/components/common";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { Atlas2DMap } from "@/components/atlas/atlas-2d-map";
import {
  ATLAS_METRICS,
  fetchAtlasData,
  formatAtlasMetricValue,
  metricDefinition,
  type AtlasData,
  type AtlasMetricKey,
} from "@/components/atlas/atlas-data";
import { useWebGL, usePrefersReducedMotion } from "@/components/twin/three-utils";
import { events } from "@/lib/analytics-tracker";
import { localeOf, t } from "@/lib/i18n";
import { formatDate, formatNumber } from "@/lib/money";
import { formatAEDPrecise, fullValueTooltip } from "@/lib/format-precise";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Box as BoxIcon,
  Crosshair,
  ExternalLink,
  Gauge,
  Layers as LayersIcon,
  Map as MapIcon,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Lazy 3D chunk — three.js loads only in 3D mode + visible viewport (§30.3). */
const Atlas3DScene = React.lazy(() => import("@/components/atlas/atlas-3d"));

class Atlas3DErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("[atlas-3d] scene failed", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const METRIC_KEYS = ATLAS_METRICS.map((m) => m.key);

function isMetricKey(v: string): v is AtlasMetricKey {
  return (METRIC_KEYS as string[]).includes(v);
}

export default function AtlasView() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const { supported: webgl, checked: webglChecked } = useWebGL();
  const reducedMotion = usePrefersReducedMotion();

  usePageMeta({
    title: `${t("atlas.title", locale)} — Investment Experts`,
    description: "City-scale Dubai investment atlas — 2D analytical map and a 3D spatial view of community price, rent, volume and yield metrics.",
    noindex: true, // §29.6 — interactive search state, not indexable content
  });

  /* ------------------------------ URL state ------------------------------ */
  const urlMode = loc.query.mode === "3d" ? "3d" : "2d";
  const urlMetric = isMetricKey(loc.query.metric ?? "") ? (loc.query.metric as AtlasMetricKey) : "ppsft";
  const urlSide = loc.query.side === "rent" ? "rent" : "sale";
  const urlCommunity = loc.query.community || null;

  /* Latest query for the memoized param writer — a plain closure over
     `loc.query` would go stale after replace-navigations (U05 pattern). */
  const queryRef = React.useRef(loc.query);
  React.useEffect(() => {
    queryRef.current = loc.query;
  }, [loc.query]);

  const setParam = React.useCallback((patch: Record<string, string | null>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...queryRef.current, ...patch })) {
      if (v) next[k] = v;
    }
    navigate("/atlas", next, { replace: true });
  }, []);

  /* ------------------------------ data ------------------------------ */
  const [data, setData] = React.useState<AtlasData | null>(null);
  const [dataError, setDataError] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    fetchAtlasData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        console.error("[atlas] data assembly failed", err);
        if (!cancelled) setDataError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------ view state ------------------------------ */
  const [layers, setLayers] = React.useState({ communities: true, projects: true });
  const [performanceMode, setPerformanceMode] = React.useState(false);
  const [resetSignal, setResetSignal] = React.useState(0);
  const [flyTo, setFlyTo] = React.useState<string | null>(null);
  const [selectedProject, setSelectedProject] = React.useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = React.useState(true);
  /* §18.4 — on mobile the controls live in a bottom sheet opened from a
     compact floating trigger on the viewport (the lg+ side panel is intact). */
  const [controlsSheetOpen, setControlsSheetOpen] = React.useState(false);
  const webglToastShown = React.useRef(false);
  const sceneToastShown = React.useRef(false);
  const [sceneFailed, setSceneFailed] = React.useState(false);

  const handleSceneUnavailable = React.useCallback(() => {
    setSceneFailed(true);
    if (!sceneToastShown.current) {
      sceneToastShown.current = true;
      toast(t("atlas.webgl.unavailable", locale));
    }
  }, [locale]);

  /* WebGL guard: ?mode=3d without WebGL → honest 2D fallback + one-time toast. */
  const mode: "2d" | "3d" = urlMode === "3d" && ((webglChecked && !webgl) || sceneFailed) ? "2d" : urlMode;
  React.useEffect(() => {
    if (urlMode === "3d" && webglChecked && !webgl && !webglToastShown.current) {
      webglToastShown.current = true;
      toast(t("atlas.webgl.unavailable", locale));
    }
  }, [urlMode, webglChecked, webgl, locale]);

  /* Analytics: 3D mode entry + metric changes (skip the initial value). */
  React.useEffect(() => {
    if (mode === "3d") events.atlas3dOpened("atlas");
  }, [mode]);
  const prevMetric = React.useRef<AtlasMetricKey | null>(null);
  React.useEffect(() => {
    if (prevMetric.current !== null && prevMetric.current !== urlMetric) {
      events.atlas3dMetricChanged(urlMetric);
    }
    prevMetric.current = urlMetric;
  }, [urlMetric]);

  /* 3D chunk gating: mode=3d AND viewport visible (IntersectionObserver). */
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [viewportVisible, setViewportVisible] = React.useState(false);
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        setViewportVisible(entries.some((e) => e.isIntersecting));
      },
      { rootMargin: "120px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* On data load: restore selection + fly to the shared community once. */
  React.useEffect(() => {
    if (!data || !urlCommunity) return;
    if (data.communities.some((c) => c.slug === urlCommunity)) setFlyTo(urlCommunity);
  }, [data, urlCommunity]);

  /* ------------------------------ derived ------------------------------ */
  const side = urlSide;
  const sideMetrics = ATLAS_METRICS.filter((m) => m.side === side);
  const metricAvail = React.useMemo(() => {
    const map = new Map<AtlasMetricKey, number>();
    for (const m of ATLAS_METRICS) {
      map.set(m.key, data?.communities.filter((c) => c.metrics[m.key]).length ?? 0);
    }
    return map;
  }, [data]);

  const metricKey = metricAvail.get(urlMetric) ? urlMetric : sideMetrics.find((m) => (metricAvail.get(m.key) ?? 0) > 0)?.key ?? "ppsft";
  const selectedCommunityData = data?.communities.find((c) => c.slug === urlCommunity) ?? null;
  const selectedProjectData = data?.projects.find((p) => p.slug === selectedProject) ?? null;

  const onSelectCommunity = React.useCallback(
    (slug: string | null) => {
      setSelectedProject(null);
      setParam({ community: slug });
    },
    [setParam]
  );
  const onSelectProject = React.useCallback((slug: string) => {
    setFlyTo(null);
    setSelectedProject(slug);
  }, []);

  const metricLabel = (key: AtlasMetricKey) => t(metricDefinition(key)?.i18nKey ?? "atlas.metric.label", locale);

  const coverage =
    data && data.coverage.from && data.coverage.to
      ? `${formatDate(data.coverage.from)} → ${formatDate(data.coverage.to)}`
      : null;

  /* ------------------------------ render ------------------------------ */
  const panelBody = selectedCommunityData ? (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="kicker">{t("atlas.panel.title", locale)}</p>
          <h3 className="font-display text-lg font-semibold leading-tight">{selectedCommunityData.name}</h3>
        </div>
        <button
          type="button"
          onClick={() => setParam({ community: null })}
          aria-label={t("atlas.panel.close", locale)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* key metrics — every value badged (§37) */}
      <div className="mt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("atlas.panel.metrics", locale)}</p>
        <dl className="mt-1.5 space-y-1.5">
          {ATLAS_METRICS.filter((m) => (metricAvail.get(m.key) ?? 0) > 0).map((m) => {
            const metric = selectedCommunityData.metrics[m.key];
            return (
              <div key={m.key} className="flex items-center justify-between gap-2 text-sm">
                <dt className="min-w-0 truncate text-muted-foreground">{metricLabel(m.key)}</dt>
                <dd className="num flex shrink-0 items-center gap-1.5 font-medium">
                  {metric ? (
                    <>
                      <span title={metric.sourceName ?? undefined}>{formatAtlasMetricValue(m.key, metric.value)}</span>
                      <DataStateBadge state={metric.state} />
                    </>
                  ) : (
                    <UnavailableValue />
                  )}
                </dd>
              </div>
            );
          })}
          {(metricAvail.get("ppsft") ?? 0) === 0 && <p className="text-xs text-muted-foreground">{t("atlas.panel.noMetrics", locale)}</p>}
        </dl>
      </div>

      {/* inventory + projects (§29.5) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {t("atlas.panel.inventory", locale)}: <span className="num font-semibold text-foreground">{formatNumber(selectedCommunityData.listingCount)}</span>
        </span>
        <span className="text-muted-foreground">
          {t("atlas.panel.projects", locale)}:{" "}
          <span className="num font-semibold text-foreground">
            {formatNumber(data?.projects.filter((p) => p.communitySlug === selectedCommunityData.slug).length ?? 0)}
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to={`/communities/${selectedCommunityData.slug}`}>
            {t("atlas.panel.open", locale)} <ExternalLink className="ms-1 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
        {(data?.projects.filter((p) => p.communitySlug === selectedCommunityData.slug) ?? []).slice(0, 3).map((p) => (
          <Button key={p.slug} asChild size="sm" variant="outline">
            <Link to={`/projects/${p.slug}`}>{p.name}</Link>
          </Button>
        ))}
      </div>
    </>
  ) : selectedProjectData ? (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="kicker">{t("atlas.project.marker", locale)}</p>
          <h3 className="font-display text-lg font-semibold leading-tight">{selectedProjectData.name}</h3>
        </div>
        <button
          type="button"
          onClick={() => setSelectedProject(null)}
          aria-label={t("atlas.panel.close", locale)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("common.community", locale)}</dt>
          <dd className="font-medium">{selectedProjectData.communityName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("common.developer", locale)}</dt>
          <dd className="font-medium">{selectedProjectData.developerName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("project.summary.totalUnits", locale)}</dt>
          <dd className="num font-medium">
            {selectedProjectData.totalUnits ? formatNumber(selectedProjectData.totalUnits) : <UnavailableValue />}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("project.summary.startingPrice", locale)}</dt>
          <dd className="num font-medium">
            {selectedProjectData.startingPrice ? (
              <span title={fullValueTooltip(Number(selectedProjectData.startingPrice.minor) / 100)}>
                {formatAEDPrecise(Number(selectedProjectData.startingPrice.minor) / 100)}
              </span>
            ) : (
              <UnavailableValue />
            )}
          </dd>
        </div>
      </dl>
      <Button asChild size="sm" className="mt-3">
        <Link to={`/projects/${selectedProjectData.slug}`}>
          {t("atlas.panel.projectOpen", locale)} <ExternalLink className="ms-1 h-3.5 w-3.5" aria-hidden />
        </Link>
      </Button>
    </>
  ) : null;

  /* Controls body (§29.4) — shared by the lg+ side panel and the mobile
     bottom sheet (§18.4); interactive rows are 44px below lg. */
  const controlsBody = (
    <div className="space-y-5 border-t border-border/60 px-4 py-4">

                  {/* sale / rent side */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("atlas.saleRent.label", locale)}</p>
                    <div className="mt-1.5 inline-flex rounded-lg border border-border/60 bg-background p-0.5">
                      {(["sale", "rent"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={side === s}
                          onClick={() => setParam({ side: s === "sale" ? null : "rent" })}
                          className={cn(
                            "min-h-11 rounded-md px-3 py-1 text-xs font-medium transition-ui lg:min-h-8",
                            side === s ? "bg-brand-soft text-brand-strong" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {t(s === "sale" ? "atlas.saleRent.sale" : "atlas.saleRent.rent", locale)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* metric picker — disabled when no community carries data */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("atlas.metric.label", locale)}</p>
                    <div className="mt-1.5 space-y-1" role="radiogroup" aria-label={t("atlas.metric.label", locale)}>
                      {sideMetrics.map((m) => {
                        const count = metricAvail.get(m.key) ?? 0;
                        const disabled = count === 0;
                        return (
                          <button
                            key={m.key}
                            type="button"
                            role="radio"
                            aria-checked={metricKey === m.key}
                            disabled={disabled}
                            title={disabled ? t("atlas.metric.unavailable", locale) : undefined}
                            onClick={() => setParam({ metric: m.key === "ppsft" ? null : m.key })}
                            className={cn(
                              "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm transition-ui lg:min-h-9",
                              metricKey === m.key
                                ? "border-brand bg-brand-soft font-semibold text-brand-strong"
                                : "border-border/60 text-foreground/85 hover:border-brand/40",
                              disabled && "cursor-not-allowed opacity-45"
                            )}
                          >
                            <span className="min-w-0 truncate">{metricLabel(m.key)}</span>
                            {!disabled && <span className="num shrink-0 text-[11px] text-muted-foreground">{formatNumber(count)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* layers */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("atlas.layers.label", locale)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(
                        [
                          { key: "communities", label: t("atlas.layers.communities", locale) },
                          { key: "projects", label: t("atlas.layers.projects", locale) },
                        ] as const
                      ).map((l) => (
                        <button
                          key={l.key}
                          type="button"
                          aria-pressed={layers[l.key]}
                          onClick={() => setLayers((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-ui lg:min-h-9",
                            layers[l.key]
                              ? "border-brand bg-brand-soft text-brand-strong"
                              : "border-border/70 bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground"
                          )}
                        >
                          <LayersIcon className="h-3.5 w-3.5" aria-hidden />
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* data coverage (read-only display) */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("atlas.dateRange.label", locale)}</p>
                    <p className="num mt-1 text-sm text-foreground/85">{coverage ?? <UnavailableValue />}</p>
                  </div>

                  {/* locate community (flyTo) */}
                  <div>
                    <label htmlFor="atlas-locate" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Crosshair className="h-3.5 w-3.5" aria-hidden /> {t("atlas.controls.locate", locale)}
                    </label>
                    <select
                      id="atlas-locate"
                      value={urlCommunity ?? ""}
                      onChange={(e) => {
                        const slug = e.target.value || null;
                        setParam({ community: slug });
                        setFlyTo(slug);
                      }}
                      className="mt-1.5 h-11 w-full rounded-lg border border-border/70 bg-card px-2.5 text-base transition-ui focus:border-brand focus:outline-none lg:h-9 lg:text-sm"
                    >
                      <option value="">{t("atlas.controls.locatePlaceholder", locale)}</option>
                      {(data?.communities ?? []).map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* reset view */}
                  <Button variant="outline" size="sm" className="h-11 w-full gap-2 lg:h-8" onClick={() => setResetSignal((n) => n + 1)}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> {t("atlas.controls.reset", locale)}
                  </Button>

                  {/* performance mode (§55 mobile capability) */}
                  <label className="flex items-center justify-between gap-2" title={t("atlas.controls.performanceHint", locale)}>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Gauge className="h-4 w-4" aria-hidden /> {t("atlas.controls.performance", locale)}
                    </span>
                    <Switch checked={performanceMode} onCheckedChange={setPerformanceMode} aria-label={t("atlas.controls.performance", locale)} />
                  </label>

                  <p className="text-[11px] leading-relaxed text-muted-foreground">{t("atlas.note.coastline", locale)}</p>
                    </div>
  );

  return (
    <div className="container-page py-8">
      {/* ------------------------------ header ------------------------------ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("atlas.title", locale)}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("atlas.sub", locale)}</p>
        </div>
        {/* 2D / 3D mode toggle (§28 default 2D; ?mode=3d persisted) */}
        <div className="inline-flex rounded-lg border border-border/70 bg-card p-0.5" role="tablist" aria-label={t("atlas.mode.label", locale)}>
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={m === "3d" && webglChecked && !webgl}
              title={m === "3d" && webglChecked && !webgl ? t("atlas.webgl.unavailable", locale) : undefined}
              onClick={() => {
                if (m === "3d") setSceneFailed(false);
                setParam({ mode: m === "2d" ? null : "3d" });
              }}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-ui lg:min-h-9",
                mode === m ? "bg-brand-soft text-brand-strong" : "text-muted-foreground hover:text-foreground",
                m === "3d" && webglChecked && !webgl && "cursor-not-allowed opacity-50"
              )}
            >
              {m === "2d" ? <MapIcon className="h-4 w-4" aria-hidden /> : <BoxIcon className="h-4 w-4" aria-hidden />}
              {m === "2d" ? t("atlas.mode.2d", locale) : t("atlas.mode.3d", locale)}
            </button>
          ))}
        </div>
      </header>

      {/* ------------------------------ main viewport + controls ------------------------------ */}
      <div className="mt-5 flex flex-col gap-4 lg:flex-row">
        {/* viewport */}
        <div
          ref={viewportRef}
          className="relative min-h-[max(26rem,70vh)] min-w-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-[#16130f] lg:min-h-[34rem]"
        >
          {!data && !dataError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
              <LoadingState rows={3} />
            </div>
          )}
          {dataError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card px-6 text-center text-sm text-muted-foreground">
              {t("common.error", locale)} — <button type="button" className="ms-1 underline" onClick={() => window.location.reload()}>{t("common.retry", locale)}</button>
            </div>
          )}
          {data && mode === "3d" && webgl && viewportVisible && (
            <Atlas3DErrorBoundary onError={handleSceneUnavailable}>
              <React.Suspense
                fallback={
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#16130f] text-sm text-[#e2d8c4]/80">
                    {t("atlas.loading3d", locale)}
                  </div>
                }
              >
                <Atlas3DScene
                communities={data.communities}
                projects={data.projects}
                metricKey={metricKey}
                layers={layers}
                selectedCommunity={urlCommunity}
                onSelectCommunity={onSelectCommunity}
                onSelectProject={onSelectProject}
                performanceMode={performanceMode}
                reducedMotion={reducedMotion}
                resetSignal={resetSignal}
                flyTo={flyTo}
                locale={locale}
                onUnavailable={handleSceneUnavailable}
                />
              </React.Suspense>
            </Atlas3DErrorBoundary>
          )}
          {data && (mode === "2d" || (webglChecked && !webgl)) && (
            <Atlas2DMap
              communities={data.communities}
              projects={data.projects}
              metricKey={metricKey}
              layers={layers}
              selectedCommunity={urlCommunity}
              onSelectCommunity={onSelectCommunity}
              onSelectProject={onSelectProject}
              flyTo={flyTo}
              locale={locale}
            />
          )}

          {/* selection info panel — overlay, never unmounts the scene (§29.5) */}
          {panelBody && (
            <aside
              className="absolute bottom-3 start-3 end-3 z-20 rounded-xl border border-border/70 bg-card/95 p-4 shadow-xl backdrop-blur-sm sm:end-auto sm:w-[22rem]"
              aria-label={t("atlas.panel.title", locale)}
            >
              {panelBody}
            </aside>
          )}
          {!panelBody && data && (
            <p className="pointer-events-none absolute bottom-3 start-3 z-20 rounded-lg bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
              {t("atlas.panel.empty", locale)}
            </p>
          )}

          {/* Mobile controls (§18.4) — compact floating 44px trigger → bottom sheet */}
          <Button
            variant="outline"
            size="sm"
            className="absolute end-3 top-3 z-20 h-11 gap-1.5 border-border/70 bg-card/95 shadow-lg backdrop-blur lg:hidden"
            aria-expanded={controlsSheetOpen}
            onClick={() => setControlsSheetOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            {t("atlas.controls.label", locale)}
          </Button>
          <Sheet open={controlsSheetOpen} onOpenChange={setControlsSheetOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[80vh] overflow-y-auto data-[state=open]:duration-200 data-[state=closed]:duration-150"
              aria-describedby={undefined}
            >
              <SheetHeader className="pb-0 text-left">
                <SheetTitle>{t("atlas.controls.label", locale)}</SheetTitle>
              </SheetHeader>
              {controlsBody}
            </SheetContent>
          </Sheet>
        </div>

        {/* control panel (§29.4) — desktop side panel (lg+); on mobile the
            controls open in a bottom sheet from the viewport trigger (§18.4) */}
        <aside className="hidden w-[17.5rem] shrink-0 lg:block" aria-label={t("atlas.controls.label", locale)}>
          <Collapsible open={controlsOpen} onOpenChange={setControlsOpen}>
            <div className="rounded-xl border border-border/70 bg-card">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold"
                  aria-expanded={controlsOpen}
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-brand" aria-hidden />
                    {t("atlas.controls.label", locale)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>{controlsBody}</CollapsibleContent>
            </div>
          </Collapsible>
        </aside>
      </div>

      {/* ------------------------------ data table (2D analytical fallback, §28/§30.4) ------------------------------ */}
      {data && (
        <section aria-labelledby="atlas-table-heading" className="mt-8">
          <h2 id="atlas-table-heading" className="font-display text-lg font-semibold">
            {t("atlas.table.title", locale)}
          </h2>
          <div className="mt-3 overflow-x-safe rounded-xl border border-border/70">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t("atlas.table.caption", locale)}</caption>
              <thead className="bg-sand/95 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="p-3">{t("atlas.table.community", locale)}</th>
                  <th scope="col" className="p-3">{metricLabel(metricKey)}</th>
                  <th scope="col" className="p-3">{t("atlas.table.period", locale)}</th>
                  <th scope="col" className="p-3">{t("atlas.panel.inventory", locale)}</th>
                  <th scope="col" className="p-3">{t("atlas.panel.projects", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {data.communities.map((c) => {
                  const metric = c.metrics[metricKey];
                  const projectCount = data.projects.filter((p) => p.communitySlug === c.slug).length;
                  return (
                    <tr key={c.slug} className="border-b border-border/40 transition-colors last:border-0 hover:bg-sand/30">
                      <td className="p-3">
                        <Link to={`/communities/${c.slug}`} className="font-medium transition-ui hover:text-brand-strong">
                          {c.name}
                        </Link>
                      </td>
                      <td className="num p-3">
                        {metric ? (
                          <span className="inline-flex items-center gap-2">
                            {formatAtlasMetricValue(metricKey, metric.value)}
                            <DataStateBadge state={metric.state} />
                          </span>
                        ) : (
                          <UnavailableValue />
                        )}
                      </td>
                      <td className="num p-3 text-muted-foreground">
                        {metric?.periodStart ? `${formatDate(metric.periodStart)} → ${formatDate(metric.periodEnd ?? metric.periodStart)}` : "—"}
                      </td>
                      <td className="num p-3">{formatNumber(c.listingCount)}</td>
                      <td className="num p-3">{formatNumber(projectCount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

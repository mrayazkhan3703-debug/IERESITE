"use client";

/**
 * Market data explorer V2 (U10 §19.4/§19.5) — one shared component driving
 * BOTH /market/transactions and /market/rents. All surfaces (KPI chips, volume
 * chart, distribution, mixes, community table, compare areas, map, export)
 * derive from ONE filtered API response so numbers can never disagree.
 *
 * Data quality: U09 validation notes retained; every figure keeps its
 * DataStateBadge / UnavailableValue semantics.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { api, qs } from "@/lib/api-client";
import {
  Breadcrumbs,
  SectionHeading,
  ProvenanceBadge,
  LoadingState,
  DataStateBadge,
  DataStateNotice,
  UnavailableValue,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sparkline } from "@/components/charts/sparkline";
import { ExplorerVolumeChart, type ExplorerStatMode } from "@/components/charts/explorer-volume-chart";
import { DistributionChart } from "./distribution-chart";
import { MixBars } from "./mix-bars";
import { AreaTrendChart } from "./area-trend-chart";
import { CommunityMetricChart } from "./community-metric-chart";
import { MarketFilters, DEFAULT_FILTERS, filtersToQuery, filtersFromQuery, filtersToUrlParams, type MarketFilterState } from "./market-filters";
import { exportMarketCsv } from "./csv-export";
import { SourceDialogButton } from "./source-dialog";
import { formatMoney, formatNumber, formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { useRoute, navigate } from "@/lib/router";
import { events } from "@/lib/analytics-tracker";
import type { MetricState } from "@/lib/data-state";
import type { CommunityCardLite, MarketResponse, SourceInfo } from "./market-types";
import type { ExplorerSeriesPoint } from "@/components/charts/explorer-volume-chart";
import { ShieldAlert, Download, Map as MapIcon, Table2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

/* Leaflet only when the map mode is actually opened (platform lazy budget). */
const ExplorerMap = dynamic(() => import("./explorer-map").then((m) => m.ExplorerMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] w-full items-center justify-center rounded-xl border border-border/70 bg-sand/40 text-sm text-muted-foreground" role="status">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading map…
    </div>
  ),
});
const buildMapPointsImport = () => import("./explorer-map").then((m) => m.buildMapPoints);

/** Human labels for the canonical exclusion-reason keys (docs/V2_DATA_PROVENANCE.md). */
const EXCLUSION_REASON_LABELS: Record<string, string> = {
  zero_bedrooms_non_studio: "zero-bedroom non-studio units",
  non_positive_rent: "non-positive annual rent",
  non_positive_amount: "non-positive amounts",
  missing_size: "missing area",
  non_positive_size: "non-positive area",
};

/** Reasons that exclude a row from charts & statistics entirely (hard invalidity). */
const HARD_EXCLUSION_REASONS = new Set(["zero_bedrooms_non_studio", "non_positive_rent", "non_positive_amount"]);

/** Transparency note: which rows were excluded, and why (V2 §19.5). */
function DataQualityNote({ validation, isTx }: { validation: NonNullable<MarketResponse["validation"]>; isTx: boolean }) {
  const hard = validation.excludedRecords;
  const hardReasons = Object.entries(validation.exclusionReasons)
    .filter(([key, n]) => HARD_EXCLUSION_REASONS.has(key) && n > 0)
    .map(([key]) => EXCLUSION_REASON_LABELS[key] ?? key);
  const soft = (validation.exclusionReasons.missing_size ?? 0) + (validation.exclusionReasons.non_positive_size ?? 0);
  if (hard === 0 && soft === 0) return null;
  return (
    <div
      role="note"
      aria-label="Data quality exclusions"
      className="mb-6 space-y-1.5 rounded-lg border border-border/70 bg-sand/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      {hard > 0 && (
        <p className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-strong" aria-hidden />
          <span>
            <span className="font-semibold text-foreground/80">
              {formatNumber(hard)} invalid record{hard === 1 ? "" : "s"} excluded
            </span>{" "}
            ({hardReasons.join(", ")}) — excluded rows do not feed the charts or statistics.
          </span>
        </p>
      )}
      {soft > 0 && (
        <p className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-strong" aria-hidden />
          <span>
            <span className="font-semibold text-foreground/80">
              {formatNumber(soft)} record{soft === 1 ? "" : "s"} lack a usable area
            </span>{" "}
            — they remain in the {isTx ? "price" : "rent"} statistics above but are excluded from per-sqft (AED/sqft)
            derived metrics, which are shown as unavailable rather than estimated.
          </span>
        </p>
      )}
    </div>
  );
}

type SortKey = "count" | "median" | "avg" | "ppsft";

export function MarketExplorer({ variant }: { variant: "transactions" | "rents" }) {
  const isTx = variant === "transactions";
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);
  const { toast } = useToast();

  const [data, setData] = React.useState<MarketResponse | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  /* V3-F §57 — initial filter state restores from the URL so shared links and
   * reloads keep the view (raw filter params, not the derived API date). */
  const [filters, setFilters] = React.useState<MarketFilterState>(() => ({
    ...DEFAULT_FILTERS,
    ...filtersFromQuery(loc.query, variant),
  }));
  const [page, setPage] = React.useState(1);
  const [statMode, setStatMode] = React.useState<ExplorerStatMode>("median");
  const [showMap, setShowMap] = React.useState(false);
  const [communities, setCommunities] = React.useState<CommunityCardLite[] | null>(null);
  const [compareAreas, setCompareAreas] = React.useState<string[]>([]);
  const [sortKey, setSortKey] = React.useState<SortKey>("count");
  const [sortAsc, setSortAsc] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const filterQuery = React.useMemo(() => filtersToQuery(filters, variant), [filters, variant]);

  /* V3-F §57 — persist the filter state to the URL (replace, no history spam).
   * Compares only the keys this explorer owns, so unrelated params survive. */
  React.useEffect(() => {
    const next = filtersToUrlParams(filters, variant);
    const owned = ["period", "community", "type", "beds", "reg"];
    const same = owned.every((k) => (loc.query[k] ?? "") === (next[k] ?? ""));
    if (!same) navigate(loc.path, next, { replace: true });
  }, [filters, variant]);

  React.useEffect(() => {
    setPage(1);
  }, [filterQuery]);

  React.useEffect(() => {
    let cancelled = false;
    const params = { ...filterQuery, page: String(page), pageSize: "15" };
    api
      .get<MarketResponse>(`/api/market/${isTx ? "transactions" : "rents"}${qs(params)}`)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ rows: [], total: 0, page: 1, pageSize: 15, byCommunity: [] });
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filterQuery, page, isTx]);

  // Communities registry for the map coordinate join — fetched once when map opens.
  React.useEffect(() => {
    if (!showMap || communities !== null) return;
    api
      .get<{ communities: CommunityCardLite[] }>("/api/communities")
      .then((r) => setCommunities(r.communities))
      .catch(() => setCommunities([]));
  }, [showMap, communities]);

  const agg = data?.agg ?? null;
  const rowState: MetricState | undefined = data?.rows?.[0]?.state;
  const isIllustrative = data?.rows?.some((r) => r.isIllustrative) ?? false;
  const label = isTx ? "transaction" : "rental contract";

  const source: SourceInfo = {
    title: isTx ? "Transactions explorer" : "Rental trends explorer",
    source: data?.rows?.[0]?.source ?? "DEMO",
    state: rowState,
    dataState: data?.dataState,
    coverage: agg ? { from: agg.dateMin, to: agg.dateMax, records: agg.count } : undefined,
    methodology: isTx
      ? "Medians and averages are computed over the validated transaction records of the current filter. Records with a missing or unusable area are excluded from per-sqft metrics only."
      : "Medians and averages are computed over the validated rental contracts of the current filter. Zero-bedroom non-studio and non-positive-rent records are excluded entirely; records without a usable area are excluded from derived per-sqft metrics only.",
    exclusions: data?.validation
      ? { excluded: data.validation.excludedRecords, reasons: data.validation.exclusionReasons }
      : undefined,
  };

  /* ------- derived displays (single source: the one API response) ------- */

  const statMinor = (a: { medianAmountMinor?: string | null; avgAmountMinor?: string | null } | undefined): string | null => {
    if (!a) return null;
    return statMode === "median" ? (a.medianAmountMinor ?? null) : (a.avgAmountMinor ?? null);
  };
  const rentStatMinor = (a: { medianRentMinor?: string | null; avgRentMinor?: string | null } | undefined): string | null => {
    if (!a) return null;
    return statMode === "median" ? (a.medianRentMinor ?? null) : (a.avgRentMinor ?? null);
  };

  const headlineMedian =
    statMode === "median"
      ? agg?.medianAmountMinor ?? agg?.medianRentMinor ?? null
      : agg?.avgAmountMinor ?? agg?.avgRentMinor ?? null;

  const areaRows = React.useMemo(() => {
    const trendByArea = new Map((data?.byCommunity ?? []).map((c) => [c.areaName, c.trend ?? []]));
    const rows = (agg?.byAreaFull ?? []).map((a) => {
      const medianStr = isTx ? a.medianAmountMinor ?? null : a.medianRentMinor ?? null;
      const avgStr = isTx ? a.avgAmountMinor ?? null : a.avgRentMinor ?? null;
      return {
        areaName: a.areaName,
        count: a.count,
        medianMinor: medianStr,
        avgMinor: avgStr,
        ppsftMinor: a.medianPerSqftMinor ?? null,
        trend: trendByArea.get(a.areaName) ?? [],
      };
    });
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case "median":
          return dir * ((Number(a.medianMinor ?? 0) || 0) - (Number(b.medianMinor ?? 0) || 0));
        case "avg":
          return dir * ((Number(a.avgMinor ?? 0) || 0) - (Number(b.avgMinor ?? 0) || 0));
        case "ppsft":
          return dir * ((Number(a.ppsftMinor ?? 0) || 0) - (Number(b.ppsftMinor ?? 0) || 0));
        default:
          return dir * (a.count - b.count);
      }
    });
    return rows;
  }, [agg, data?.byCommunity, sortKey, sortAsc, isTx]);

  const [mapPointsState, setMapPointsState] = React.useState<{
    points: { areaName: string; communityName: string; lat: number; lng: number; count: number; medianMinor: number | null }[];
    unmatched: number;
  } | null>(null);
  React.useEffect(() => {
    if (!showMap || communities === null || !agg) return;
    let cancelled = false;
    buildMapPointsImport().then((build) => {
      if (cancelled) return;
      const points = build(agg.byAreaFull, communities);
      setMapPointsState({ points, unmatched: agg.byAreaFull.length - points.length });
    });
    return () => {
      cancelled = true;
    };
  }, [showMap, communities, agg]);

  const toggleCompareArea = (areaName: string) => {
    setCompareAreas((prev) => {
      if (prev.includes(areaName)) return prev.filter((a) => a !== areaName);
      if (prev.length >= 4) return prev;
      return [...prev, areaName];
    });
  };

  const handleExport = async () => {
    setExporting(true);
    const res = await exportMarketCsv(variant, filterQuery);
    setExporting(false);
    if ("error" in res) {
      toast({ title: "Export failed", description: "The CSV could not be generated. Try again.", variant: "destructive" });
    } else {
      toast({ title: "CSV exported", description: `${formatNumber(res.rows)} records with the current filters.` });
    }
  };

  const handleFilterChange = (next: MarketFilterState) => {
    const changedKey = (Object.keys(next) as (keyof MarketFilterState)[]).find((k) => next[k] !== filters[k]);
    if (changedKey) events.marketExplorerFilter(variant, changedKey);
    setFilters(next);
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "count" ? false : true);
    }
  };

  const sortTh = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sortKey === key ? (sortAsc ? "ascending" : "descending") : "none"} className="p-3 font-medium">
      <button
        type="button"
        onClick={() => sortBy(key)}
        className={cn(
          "inline-flex items-center gap-1 transition-ui hover:text-foreground",
          sortKey === key && "text-brand-strong"
        )}
      >
        {label}
        {sortKey === key && <span aria-hidden>{sortAsc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="pb-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Market Intelligence", to: "/market" }, { label: isTx ? "Transactions" : "Rental Trends" }]} />
      <div className="mt-4">
        <SectionHeading
          as="h1"
          kicker="Data explorer"
          title={isTx ? "Sale transactions explorer" : "Rental trends explorer"}
          description={
            isTx
              ? "Every row carries its source. Medians, distributions and volumes over the validated record set — one filter drives every chart and table on this page."
              : "Rental contracts by area and bedrooms — medians, distributions and trends over the validated record set. Illustrative until the DLD rents import is connected."
          }
          action={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <ToggleGroup
                type="single"
                value={statMode}
                onValueChange={(v) => {
                  if (v) setStatMode(v as ExplorerStatMode);
                }}
                variant="outline"
                size="sm"
                aria-label={t_("market.explorer.statMode.sr")}
              >
                <ToggleGroupItem value="median" className="h-11 gap-1 text-xs sm:h-8">{t_("market.explorer.statMode.median")}</ToggleGroupItem>
                <ToggleGroupItem value="average" className="h-11 gap-1 text-xs sm:h-8">{t_("market.explorer.statMode.average")}</ToggleGroupItem>
              </ToggleGroup>
              <Button variant="outline" size="sm" className="h-11 gap-1.5 sm:h-8" onClick={handleExport} disabled={exporting || (data?.total ?? 0) === 0}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                {t_("market.explorer.export")}
                <span className="sr-only">{t_("market.explorer.export.sr")}</span>
              </Button>
              <Button
                variant={showMap ? "default" : "outline"}
                size="sm"
                className="h-11 gap-1.5 sm:h-8"
                aria-pressed={showMap}
                onClick={() => {
                  setShowMap((v) => !v);
                  if (!showMap) events.mapOpened(`explorer-${variant}`);
                }}
              >
                <MapIcon className="h-4 w-4" aria-hidden /> {t_("market.explorer.mapToggle")}
              </Button>
            </div>
          }
        />
      </div>

      {/* Environment disclosure — demo/staging datasets only (V2 §5.1) */}
      <DataStateNotice scope={isTx ? "the transactions explorer" : "the rental trends explorer"} className="mt-5" />

      {/* Synchronized filters (§19.3) — one state, every surface */}
      <div className="mt-6">
        <MarketFilters variant={variant} filters={filters} onChange={handleFilterChange} agg={agg} />
      </div>

      {/* Record counter */}
      {data && (
        <p className="num mb-4 -mt-2 text-sm text-muted-foreground">
          {formatNumber(data.total)} {label}{data.total === 1 ? "" : "s"} in view
          {agg && agg.excludedRecords > 0 ? ` · ${formatNumber(agg.excludedRecords)} excluded as invalid` : ""}
          {headlineMedian !== null && headlineMedian !== undefined
            ? ` · ${statMode} ${isTx ? "price" : "rent"} ${formatMoney(headlineMedian, { currency: "AED", compact: true })}`
            : ""}
        </p>
      )}

      {/* Validation transparency — excluded rows are reported, never hidden (V2 §19.5) */}
      {data?.validation && <DataQualityNote validation={data.validation} isTx={isTx} />}

      {loadError && (
        <p className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          The dataset could not be loaded. Try resetting the filters.
        </p>
      )}

      {/* Map mode (§19.4): right rail on desktop, inline collapsible on mobile */}
      {showMap && (
        <div className="mb-6">
          {communities === null || mapPointsState === null ? (
            <div className="flex h-[340px] w-full items-center justify-center rounded-xl border border-border/70 bg-sand/40 text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t_("market.explorer.map.loading")}
            </div>
          ) : (
            <ExplorerMap
              points={mapPointsState.points}
              variant={variant}
              unmatchedAreas={mapPointsState.unmatched}
              title={t_(isTx ? "market.explorer.map.titleTx" : "market.explorer.map.titleRent")}
              note={t_(isTx ? "market.explorer.map.note" : "market.explorer.map.noteRent")}
            />
          )}
        </div>
      )}

      {/* Area summary cards — median/average per the stat-mode toggle */}
      {areaRows.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {areaRows.slice(0, 8).map((c) => {
            const valueMinor = isTx ? (statMode === "median" ? c.medianMinor : c.avgMinor) : (statMode === "median" ? c.medianMinor : c.avgMinor);
            return (
              <div
                key={c.areaName}
                className="group rounded-lg border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.areaName}</p>
                    {valueMinor ? (
                      <p className="num mt-1.5 font-display text-xl font-semibold text-brand-strong">
                        {formatMoney(valueMinor, { currency: "AED", compact: true })}
                        {!isTx && <span className="text-xs font-normal text-muted-foreground">/yr</span>}
                      </p>
                    ) : (
                      <p className="mt-1.5">
                        <UnavailableValue />
                      </p>
                    )}
                  </div>
                  {c.trend && c.trend.length > 1 && (
                    <div className="shrink-0 pt-0.5 opacity-80 transition-opacity group-hover:opacity-100">
                      <Sparkline values={c.trend} label={`${c.areaName} monthly ${isTx ? "transactions" : "rental contracts"}`} />
                    </div>
                  )}
                </div>
                <p className="num mt-1 text-[11px] text-muted-foreground/80">
                  {formatNumber(c.count)} {c.count === 1 ? "record" : "records"} · {statMode} {isTx ? "price" : "rent"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly volume & price-statistic chart (median/average toggle §19.4) */}
      {data?.series && data.series.length > 1 && (
        <div className="mb-6">
          <ExplorerVolumeChart
            series={data.series as ExplorerSeriesPoint[]}
            variant={variant}
            isIllustrative={isIllustrative}
            statMode={statMode}
            action={<SourceDialogButton info={{ ...source, title: isTx ? "Volume & price trend" : "Volume & rent trend" }} />}
          />
        </div>
      )}

      {/* Distribution + mixes (§19.4/§19.5) */}
      {agg && agg.distribution.length > 0 && (
        <div className="mb-6">
          <DistributionChart buckets={agg.distribution} variant={variant} source={{ ...source, title: isTx ? "Price distribution" : "Rent distribution" }} />
        </div>
      )}

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        {agg && agg.byPropertyType.length > 0 && (
          <MixBars
            title={t_("market.explorer.mix.type")}
            data={agg.byPropertyType.map((x) => ({ label: x.type, count: x.count, medianMinor: x.medianAmountMinor }))}
            medianLabel={isTx ? "median" : "median rent"}
            source={{ ...source, title: t_("market.explorer.mix.type") }}
          />
        )}
        {!isTx && agg?.byBedrooms && agg.byBedrooms.length > 0 && (
          <MixBars
            title={t_("market.explorer.mix.beds")}
            data={agg.byBedrooms.map((x) => ({
              label: x.bedrooms === 0 ? t_("market.filters.beds.studio") : t_("market.filters.beds.n").replace("{n}", String(x.bedrooms)),
              count: x.count,
              medianMinor: x.medianRentMinor,
            }))}
            medianLabel="median rent"
            source={{ ...source, title: t_("market.explorer.mix.beds") }}
          />
        )}
      </div>

      {/* Compare areas (§19.5) — 2–4 chips → side-by-side medians + trend lines */}
      {agg && agg.filterOptions.areas.length >= 2 && (
        <section className="mb-6" aria-labelledby="compare-areas-heading">
          <div className="mb-3">
            <h3 id="compare-areas-heading" className="font-display text-lg font-semibold">
              Compare areas
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Pick 2–4 areas from the current filter — medians side by side, trends below.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Compare areas selection">
            {agg.filterOptions.areas.map((a) => {
              const selected = compareAreas.includes(a.areaName);
              const disabled = !selected && compareAreas.length >= 4;
              return (
                <button
                  key={a.areaName}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggleCompareArea(a.areaName)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                    selected
                      ? "border-brand bg-brand-soft text-brand-strong shadow-sm"
                      : disabled
                        ? "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground/50"
                        : "border-border bg-card text-foreground/80 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md"
                  )}
                >
                  {a.areaName}
                  <span className="num ml-1.5 text-[10px] text-muted-foreground">{formatNumber(a.count)}</span>
                </button>
              );
            })}
            {compareAreas.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => setCompareAreas([])}>
                {t_("market.compare.clear")}
              </Button>
            )}
          </div>
          {compareAreas.length >= 2 && agg.areaSeries.length > 0 && (
            <div className="mt-4 grid gap-5">
              <CommunityMetricChart
                title={`${statMode === "median" ? "Median" : "Average"} ${isTx ? "price" : "rent"} by area`}
                data={compareAreas.map((name) => {
                  const a = agg.byAreaFull.find((x) => x.areaName === name);
                  const v = isTx ? statMinor(a) : rentStatMinor(a);
                  return { name, value: v !== null && v !== undefined ? Number(v) : null };
                })}
                format="aedMinor"
                source={{ ...source, title: "Area comparison" }}
              />
              <AreaTrendChart areaSeries={agg.areaSeries} selected={compareAreas} variant={variant} source={{ ...source, title: "Area trends" }} />
            </div>
          )}
        </section>
      )}

      {/* Community comparison table (§19.4) — sortable, shares the filter */}
      {areaRows.length > 0 && (
        <section className="mb-6" aria-labelledby="community-table-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="community-table-heading" className="font-display text-lg font-semibold">
                {t_("market.explorer.communityTable.title")}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isTx ? "All areas in the current filter, sorted by any column." : "All areas in the current filter, sorted by any column."}
              </p>
            </div>
            <SourceDialogButton info={{ ...source, title: t_("market.explorer.communityTable.title") }} />
          </div>
          {/* §40 mobile (<sm): one stacked labeled card per area (count header +
              median/average/AED-sqft rows); ≥sm the sortable table. */}
          <ul className="space-y-3 sm:hidden" aria-label={t_("market.explorer.communityTable.cardsSr")}>
            {areaRows.map((c) => (
              <li key={c.areaName} className="rounded-lg border border-border/70 bg-card p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{c.areaName}</p>
                  <p className="num shrink-0 text-[11px] text-muted-foreground">
                    {formatNumber(c.count)} {t_(isTx ? "market.explorer.communityTable.countTx" : "market.explorer.communityTable.countRent")}
                  </p>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/50 pt-2.5 text-xs">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      {t_(isTx ? "market.explorer.communityTable.median" : "market.explorer.communityTable.medianRent")}
                    </dt>
                    <dd className="num mt-0.5 font-medium">
                      {c.medianMinor ? formatMoney(c.medianMinor, { currency: "AED", compact: true }) : <UnavailableValue />}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      {t_(isTx ? "market.explorer.communityTable.average" : "market.explorer.communityTable.averageRent")}
                    </dt>
                    <dd className="num mt-0.5">
                      {c.avgMinor ? formatMoney(c.avgMinor, { currency: "AED", compact: true }) : <UnavailableValue />}
                    </dd>
                  </div>
                  {isTx && (
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.ppsft")}</dt>
                      <dd className="num mt-0.5">
                        {c.ppsftMinor ? formatMoney(c.ppsftMinor, { currency: "AED" }) : <UnavailableValue />}
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-safe rounded-lg border border-border/70 sm:block">
            <table className="w-full min-w-[620px] text-sm">
              <caption className="sr-only">{t_("market.explorer.communityTable.title")}</caption>
              <thead>
                <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {sortTh("count", isTx ? t_("market.explorer.communityTable.countTx") : t_("market.explorer.communityTable.countRent"))}
                  <th scope="col" className="p-3 font-medium">{t_("market.explorer.communityTable.area")}</th>
                  {sortTh("median", `${t_("market.explorer.communityTable.median")}${isTx ? "" : " rent"}`)}
                  {sortTh("avg", `${t_("market.explorer.communityTable.average")}${isTx ? "" : " rent"}`)}
                  {isTx && sortTh("ppsft", t_("market.explorer.communityTable.ppsft"))}
                </tr>
              </thead>
              <tbody>
                {areaRows.map((c) => (
                  <tr key={c.areaName} className="border-b border-border/40 transition-colors last:border-0 hover:bg-sand/30">
                    <td className="num p-3 font-medium">{formatNumber(c.count)}</td>
                    <td className="p-3 font-medium">{c.areaName}</td>
                    <td className="num p-3">
                      {c.medianMinor ? formatMoney(c.medianMinor, { currency: "AED", compact: true }) : <UnavailableValue />}
                    </td>
                    <td className="num p-3 text-muted-foreground">
                      {c.avgMinor ? formatMoney(c.avgMinor, { currency: "AED", compact: true }) : <UnavailableValue />}
                    </td>
                    {isTx && (
                      <td className="num p-3 text-muted-foreground">
                        {c.ppsftMinor ? formatMoney(c.ppsftMinor, { currency: "AED" }) : <UnavailableValue />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Records — §40 mobile (<sm): one stacked card per record with labeled
          rows (Date/Area/Type/Amount/Size/AED-sqft/Provenance); ≥sm the table. */}
      {data === null ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="font-display text-lg font-semibold">{isTx ? "Transaction records" : "Rental contracts"}</h3>
          </div>
          <div className="sm:hidden">
            <ul className="space-y-3" aria-label={isTx ? t_("market.records.txSr") : t_("market.records.rentSr")}>
              {data.rows.length === 0 && (
                <li className="rounded-lg border border-border/70 bg-card p-6 text-center text-sm text-muted-foreground">
                  No {label} records match the current filters. Try resetting the filters above.
                </li>
              )}
              {data.rows.map((r) => (
                <li key={r.id} className="rounded-lg border border-border/70 bg-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.areaName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{formatDate(r.transactionDate ?? r.contractDate)}</span>
                        <span aria-hidden>·</span>
                        <span>{r.propertyType}</span>
                        {!isTx && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="num">
                              {r.bedrooms === null || r.bedrooms === undefined ? (
                                <UnavailableValue label="Bedrooms" />
                              ) : r.bedrooms === 0 ? (
                                t_("market.filters.beds.studio")
                              ) : (
                                r.bedrooms
                              )}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <p className="num shrink-0 text-sm font-semibold text-brand-strong">
                      {formatMoney(r.amountMinor ?? r.annualRentMinor, { currency: "AED", compact: true })}
                      {!isTx && <span className="text-[11px] font-normal text-muted-foreground">/yr</span>}
                    </p>
                  </div>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/50 pt-2.5 text-xs">
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.date")}</dt>
                      <dd className="num mt-0.5">{formatDate(r.transactionDate ?? r.contractDate)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.area")}</dt>
                      <dd className="mt-0.5 truncate">{r.areaName}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.type")}</dt>
                      <dd className="mt-0.5">{r.propertyType}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{isTx ? t_("market.records.amount") : t_("market.records.annualRent")}</dt>
                      <dd className="num mt-0.5 font-medium">{formatMoney(r.amountMinor ?? r.annualRentMinor, { currency: "AED", compact: true })}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.size")}</dt>
                      <dd className="num mt-0.5">{r.sizeSqft ? formatNumber(r.sizeSqft) : <UnavailableValue label="Area" />}</dd>
                    </div>
                    {isTx && (
                      <div className="min-w-0">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.ppsft")}</dt>
                        <dd className="num mt-0.5">{r.pricePerSqftMinor ? formatMoney(r.pricePerSqftMinor, { currency: "AED" }) : <UnavailableValue />}</dd>
                      </div>
                    )}
                    <div className={cn("min-w-0", isTx && "col-span-2")}>
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">{t_("market.records.provenance")}</dt>
                      <dd className="mt-0.5">
                        {r.state ? (
                          <DataStateBadge state={r.state} />
                        ) : r.isIllustrative ? (
                          <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: true }} />
                        ) : (
                          <span className="text-xs text-muted-foreground">{r.source}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden overflow-x-safe rounded-lg border border-border/70 sm:block">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">{isTx ? "Sale transactions" : "Rental contracts"}</caption>
              <thead>
                <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="p-3 font-medium">{t_("market.records.date")}</th>
                  <th scope="col" className="p-3 font-medium">{t_("market.records.area")}</th>
                  <th scope="col" className="p-3 font-medium">{t_("market.records.type")}</th>
                  {!isTx && <th scope="col" className="p-3 font-medium">{t_("market.records.beds")}</th>}
                  <th scope="col" className="p-3 font-medium">{isTx ? t_("market.records.amount") : t_("market.records.annualRent")}</th>
                  <th scope="col" className="p-3 font-medium">{t_("market.records.size")}</th>
                  {isTx && <th scope="col" className="p-3 font-medium">{t_("market.records.ppsft")}</th>}
                  <th scope="col" className="p-3 font-medium">{t_("market.records.provenance")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={isTx ? 7 : 7} className="p-8 text-center text-muted-foreground">
                      No {label} records match the current filters. Try resetting the filters above.
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 transition-colors last:border-0 hover:bg-sand/30">
                    <td className="p-3 text-muted-foreground">{formatDate(r.transactionDate ?? r.contractDate)}</td>
                    <td className="p-3 font-medium">{r.areaName}</td>
                    <td className="p-3 text-muted-foreground">{r.propertyType}</td>
                    {!isTx && (
                      <td className="num p-3 text-muted-foreground">
                        {r.bedrooms === null || r.bedrooms === undefined ? (
                          <UnavailableValue label="Bedrooms" />
                        ) : r.bedrooms === 0 ? (
                          "Studio"
                        ) : (
                          r.bedrooms
                        )}
                      </td>
                    )}
                    <td className="num p-3 font-medium">{formatMoney(r.amountMinor ?? r.annualRentMinor, { currency: "AED", compact: true })}</td>
                    <td className="num p-3 text-muted-foreground">
                      {r.sizeSqft ? formatNumber(r.sizeSqft) : <UnavailableValue label="Area" />}
                    </td>
                    {isTx && (
                      <td className="num p-3 text-muted-foreground">
                        {r.pricePerSqftMinor ? formatMoney(r.pricePerSqftMinor, { currency: "AED" }) : <UnavailableValue />}
                      </td>
                    )}
                    <td className="p-3">
                      {r.state ? (
                        <DataStateBadge state={r.state} />
                      ) : r.isIllustrative ? (
                        <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: true }} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.source}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" className="h-11 px-4 sm:h-8 sm:px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="num px-2 text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
            <Button variant="outline" size="sm" className="h-11 px-4 sm:h-8 sm:px-3" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}

      <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
        All aggregates on this page — headline medians, distributions, mixes, area cards and the community table — are
        computed by the API over the SAME validated rows as the record list, under the SAME filters. Numbers between
        surfaces cannot disagree by construction.
      </p>
    </div>
  );
}

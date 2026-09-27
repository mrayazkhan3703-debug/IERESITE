"use client";

/**
 * Community market intelligence (U08 — V2 §16 "market section").
 *
 * Decision-grade market block assembled from three honest data planes:
 *  1. Stored community metrics (latest per key) — every figure carries a
 *     DataStateBadge from the §37 machine + source + period.
 *  2. Observed market records — transaction and rent explorers filtered to the
 *     community's area name; monthly volume/average charts with sample counts.
 *  3. Observed vs modeled yields — observed gross yield derived live from the
 *     two observed medians (labeled OBSERVED), next to the stored modeled
 *     YIELD_PCT metric (labeled MODELED). Never conflated.
 *
 * Supply pipeline: community projects grouped by construction status.
 * Empty planes are omitted or shown as UnavailableValue — never fabricated.
 */

import * as React from "react";
import { api } from "@/lib/api-client";
import { resolveMetricState, type MetricState } from "@/lib/data-state";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatNumber, formatDate } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import { latestMetricsByKey, median, monthLabel, humanizeTitle, type EntityMetricRow } from "./entity-shared";
import { MetricTrendChart, MonthlySeriesChart, type MonthlySeriesPoint } from "./entity-charts";
import { Building2, HardHat, Info } from "lucide-react";
import { Link } from "@/lib/router";

interface TxRow {
  amountMinor: string;
  pricePerSqftMinor: string | null;
  sizeSqft: number | null;
  state: MetricState;
}
interface RentRow {
  annualRentMinor: string;
  sizeSqft: number | null;
  state: MetricState;
}

interface EntityMarketProps {
  community: {
    name: string;
    slug: string;
    currency: string;
    metrics: EntityMetricRow[];
    supplyPipeline: { totalProjects: number; underConstruction: number; offPlan: number; ready: number };
    projects: { slug: string; name: string; status: string }[];
  };
  locale?: Locale;
}

const METRIC_ORDER = ["MEDIAN_TRANS_PRICE", "AVG_PRICE_PER_SQFT", "AVG_RENT_1BR", "YIELD_PCT", "TRANSACTION_COUNT"];

function metricStateOf(m: EntityMetricRow): MetricState {
  return resolveMetricState({
    sourcePublisher: m.sourceName,
    sourceType: m.sourceName,
    methodology: m.methodology,
    isIllustrative: m.isIllustrative,
  });
}

function metricValue(m: EntityMetricRow): string {
  if (m.unit === "PERCENT") return formatPctPrecise(m.valueNumeric, 1);
  if (m.unit === "COUNT") return formatNumber(m.valueNumeric);
  return formatAEDPrecise(m.valueNumeric);
}

export function EntityMarket({ community, locale = "en" }: EntityMarketProps) {
  /* Observed market records (transactions + rents) for this community's area */
  const [tx, setTx] = React.useState<{ series: MonthlySeriesPoint[]; rows: TxRow[]; total: number } | null>(null);
  const [rents, setRents] = React.useState<{ series: MonthlySeriesPoint[]; rows: RentRow[]; total: number } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ series: { month: string; count: number; avgAmountMinor: string }[]; rows: TxRow[]; total: number }>(
        `/api/market/transactions?community=${encodeURIComponent(community.name)}&pageSize=50`
      )
      .then((r) => {
        if (cancelled) return;
        setTx({
          series: (r.series ?? []).map((s) => ({ month: s.month, count: s.count, avgMajor: Number(s.avgAmountMinor) / 100 })),
          rows: r.rows ?? [],
          total: r.total ?? 0,
        });
      })
      .catch(() => !cancelled && setTx({ series: [], rows: [], total: 0 }));
    api
      .get<{ series: { month: string; count: number; avgAmountMinor: string }[]; rows: RentRow[]; total: number }>(
        `/api/market/rents?community=${encodeURIComponent(community.name)}&pageSize=50`
      )
      .then((r) => {
        if (cancelled) return;
        setRents({
          series: (r.series ?? []).map((s) => ({ month: s.month, count: s.count, avgMajor: Number(s.avgAmountMinor) / 100 })),
          rows: r.rows ?? [],
          total: r.total ?? 0,
        });
      })
      .catch(() => !cancelled && setRents({ series: [], rows: [], total: 0 }));
    return () => {
      cancelled = true;
    };
  }, [community.name]);

  /* Latest stored metrics per key */
  const latest = React.useMemo(() => {
    const map = latestMetricsByKey(community.metrics);
    return METRIC_ORDER.filter((k) => map.has(k)).map((k) => map.get(k)!);
  }, [community.metrics]);

  /* Quarterly price/sqft (+ modeled yield) trend from stored metrics */
  const trendPoints = React.useMemo(() => {
    const byQuarter = new Map<string, { periodStart: string; price?: number; yield?: number }>();
    for (const m of community.metrics) {
      if (m.metricKey !== "AVG_PRICE_PER_SQFT" && m.metricKey !== "YIELD_PCT") continue;
      const d = new Date(m.periodStart);
      const q = `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`;
      const e = byQuarter.get(q) ?? { periodStart: m.periodStart };
      if (m.periodStart > e.periodStart) e.periodStart = m.periodStart;
      if (m.metricKey === "AVG_PRICE_PER_SQFT") e.price = m.valueNumeric;
      else e.yield = m.valueNumeric;
      byQuarter.set(q, e);
    }
    return Array.from(byQuarter.entries())
      .map(([label, e]) => ({ label, primary: e.price, secondary: e.yield }))
      .filter((p) => p.primary !== undefined)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [community.metrics]);

  /* Observed medians (only when the explorers actually returned rows) */
  const observed = React.useMemo(() => {
    if (!tx || !rents) return null;
    const medianPrice = tx.rows.length > 0 ? median(tx.rows.map((r) => Number(r.amountMinor) / 100)) : null;
    const medianPpsf =
      tx.rows.length > 0 ? median(tx.rows.filter((r) => r.pricePerSqftMinor).map((r) => Number(r.pricePerSqftMinor) / 100)) : null;
    const medianRent = rents.rows.length > 0 ? median(rents.rows.map((r) => Number(r.annualRentMinor) / 100)) : null;
    const observedYield = medianPrice && medianPrice > 0 && medianRent ? (medianRent / medianPrice) * 100 : null;
    /* Presentation state inherits the observed rows' own §37 state (ILLUSTRATIVE
     * in this environment) — an observed computation over demo fixtures is still
     * illustrative, never silently upgraded to VERIFIED_SOURCE. */
    const rowsState = tx.rows[0]?.state ?? rents.rows[0]?.state ?? "UNAVAILABLE";
    return { medianPrice, medianPpsf, medianRent, observedYield, txCount: tx.total, rentCount: rents.total, rowsState };
  }, [tx, rents]);

  const modeledYieldMetric = latest.find((m) => m.metricKey === "YIELD_PCT");

  return (
    <div className="space-y-5">
      {/* Latest metrics grid */}
      {latest.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {latest.map((m) => (
            <div key={m.metricKey} className="rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`community.metric.${m.metricKey}`, locale)}
                </p>
                <DataStateBadge state={metricStateOf(m)} />
              </div>
              <p className="num mt-2 font-display text-2xl font-semibold" title={m.unit === "PERCENT" || m.unit === "COUNT" ? undefined : formatAEDPrecise(m.valueNumeric)}>
                {metricValue(m)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {m.sourceName} · {formatDate(m.periodStart)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("community.market.noMetrics", locale)}</p>
      )}

      {/* Price/sqft + modeled yield trend */}
      {trendPoints.length >= 2 && (
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-semibold">{t("community.market.priceTrend", locale)}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("community.market.priceTrendSub", locale).replace("{n}", String(trendPoints.length))}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <MetricTrendChart
              points={trendPoints}
              labels={[t("community.market.ppsf", locale), t("community.market.grossYield", locale)]}
              ariaLabel={t("community.market.priceTrendAria", locale)}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("community.market.metricFootnote", locale)}
          </p>
        </div>
      )}

      {/* Observed transaction + rent trends (2-up) */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h3 className="font-display text-lg font-semibold">{t("community.market.txTrend", locale)}</h3>
          {tx === null ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("common.loading", locale)}</p>
          ) : tx.series.length >= 2 ? (
            <>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("community.market.observedCount", locale).replace("{n}", formatNumber(tx.total))} · {t("community.market.observedSource", locale)}
              </p>
              <div className="mt-3">
                <MonthlySeriesChart
                  points={tx.series}
                  unitLabel={t("community.market.avgPrice", locale)}
                  ariaLabel={t("community.market.txTrendAria", locale)}
                />
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              <UnavailableValue label={t("community.market.txRecords", locale)} />
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h3 className="font-display text-lg font-semibold">{t("community.market.rentTrend", locale)}</h3>
          {rents === null ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("common.loading", locale)}</p>
          ) : rents.series.length >= 2 ? (
            <>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("community.market.observedCount", locale).replace("{n}", formatNumber(rents.total))} · {t("community.market.observedSource", locale)}
              </p>
              <div className="mt-3">
                <MonthlySeriesChart
                  points={rents.series}
                  unitLabel={t("community.market.avgRent", locale)}
                  ariaLabel={t("community.market.rentTrendAria", locale)}
                />
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              <UnavailableValue label={t("community.market.rentRecords", locale)} />
            </p>
          )}
        </div>
      </div>

      {/* Observed vs modeled yields */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">{t("community.market.yields", locale)}</h3>
          </div>
          <dl className="mt-3 space-y-3">
            <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-3">
              <div>
                <dt className="text-sm font-medium">{t("community.market.observedYield", locale)}</dt>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">
                  {observed && observed.observedYield !== null
                    ? t("community.market.yieldBasis", locale)
                        .replace("{tx}", formatNumber(observed.txCount))
                        .replace("{rent}", formatNumber(observed.rentCount))
                    : ""}
                </dd>
              </div>
              <dd className="num text-right text-lg font-semibold">
                {observed?.observedYield !== null && observed?.observedYield !== undefined ? (
                  <span className="flex flex-col items-end">
                    <span>{formatPctPrecise(observed.observedYield, 1)}</span>
                    <DataStateBadge state={observed.rowsState} />
                  </span>
                ) : (
                  <UnavailableValue />
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <dt className="text-sm font-medium">{t("community.market.modeledYield", locale)}</dt>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">
                  {modeledYieldMetric ? `${modeledYieldMetric.sourceName} · ${formatDate(modeledYieldMetric.periodStart)}` : ""}
                </dd>
              </div>
              <dd className="num text-right text-lg font-semibold">
                {modeledYieldMetric ? (
                  <span className="flex flex-col items-end">
                    <span>{formatPctPrecise(modeledYieldMetric.valueNumeric, 1)}</span>
                    <DataStateBadge state={metricStateOf(modeledYieldMetric)} />
                  </span>
                ) : (
                  <UnavailableValue />
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("community.market.yieldFootnote", locale)}
          </p>
        </div>

        {/* Supply pipeline */}
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <h3 className="font-display text-lg font-semibold">{t("community.market.supply", locale)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("community.market.supplySub", locale)}</p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-sand/50 p-3 text-center">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("community.market.totalProjects", locale)}</dt>
              <dd className="num mt-1 font-display text-xl font-semibold">{formatNumber(community.supplyPipeline.totalProjects)}</dd>
            </div>
            <div className="rounded-lg bg-sand/50 p-3 text-center">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("community.market.underConstruction", locale)}</dt>
              <dd className="num mt-1 font-display text-xl font-semibold">{formatNumber(community.supplyPipeline.underConstruction)}</dd>
            </div>
            <div className="rounded-lg bg-sand/50 p-3 text-center">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("community.market.offPlan", locale)}</dt>
              <dd className="num mt-1 font-display text-xl font-semibold">{formatNumber(community.supplyPipeline.offPlan)}</dd>
            </div>
          </dl>
          {community.projects.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {community.projects.slice(0, 6).map((p) => (
                <li key={p.slug}>
                  <Link
                    to={`/projects/${p.slug}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3.5 py-2 text-sm transition-ui hover:border-brand/40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {p.status === "UNDER_CONSTRUCTION" ? (
                        <HardHat className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                      ) : (
                        <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                      )}
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{humanizeTitle(p.status)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("community.market.supplyFootnote", locale)}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Price history V2 (V2 §14.7).
 *
 * Hard separation between:
 *  1. ASKING PRICE HISTORY — this listing's recorded asking prices, deduplicated
 *     via the U09 `dedupePriceHistory` hygiene helper (same date+price = one
 *     event; malformed rows dropped), with change columns and per-row
 *     data-state badges. Chart uses the shared chart-theme tokens.
 *  2. TRANSACTION CONTEXT — community comparables from the validated
 *     transactions explorer (separate section, contrast background, explicit
 *     wording) so asking-price changes are never visually implied to be
 *     market transactions.
 */

import * as React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { dedupePriceHistory, type PriceHistoryEntryInput } from "@/lib/price-history";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { CHART_COLORS, CHART_SEMANTIC, CHART_AXIS, CHART_TOOLTIP_STYLE, CHART_CURSOR } from "@/lib/chart-theme";
import { api } from "@/lib/api-client";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatDate } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import type { MetricState } from "@/lib/data-state";
import { humanizeEnum, median, pricePointState } from "./detail-shared";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransactionRow {
  id: string;
  transactionDate: string;
  areaName: string;
  propertyType: string;
  amountMinor: string;
  currency: string;
  sizeSqft: number | null;
  pricePerSqftMinor: string | null;
  projectName: string | null;
  isIllustrative: boolean;
  source: string;
  state: MetricState;
}

export function PriceHistoryV2({
  priceHistory,
  currency = "AED",
  isDemoData,
  communityName,
  locale = "en",
}: {
  priceHistory: { priceMinor: string; recordedAt: string; sourceType: string }[];
  currency?: string;
  isDemoData: boolean;
  communityName: string | null;
  locale?: Locale;
}) {
  /* ---------------- asking history — deduplicated (U09 helper) ---------------- */
  const deduped = React.useMemo(() => {
    const input: PriceHistoryEntryInput[] = priceHistory.map((p) => ({
      date: p.recordedAt,
      priceMinor: p.priceMinor,
      sourceType: p.sourceType,
    }));
    return dedupePriceHistory(input);
  }, [priceHistory]);

  const droppedCount = priceHistory.length - deduped.length;

  const chartData = React.useMemo(
    () =>
      deduped.map((p) => ({
        label: formatDate(p.date, "en-GB", { month: "short", year: "2-digit", timeZone: "Asia/Dubai" }),
        price: Number(p.priceMinor) / 100,
        full: fullValueTooltip(Number(p.priceMinor) / 100),
      })),
    [deduped]
  );

  const last = deduped[deduped.length - 1];
  const prev = deduped[deduped.length - 2];

  /* ---------------- transaction context — community comparables ---------------- */
  const [transactions, setTransactions] = React.useState<TransactionRow[] | null>(null);
  React.useEffect(() => {
    if (!communityName) {
      setTransactions([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ rows: TransactionRow[]; validation: { validRecords: number; excludedRecords: number } }>(
        `/api/market/transactions?community=${encodeURIComponent(communityName)}&pageSize=50`
      )
      .then((res) => !cancelled && setTransactions(res?.rows ?? []))
      .catch(() => !cancelled && setTransactions([]));
    return () => {
      cancelled = true;
    };
  }, [communityName]);

  const comparables = React.useMemo(
    () =>
      (transactions ?? [])
        .slice()
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
        .slice(0, 3),
    [transactions]
  );
  const communityMedianPsqft = React.useMemo(() => {
    const vals = (transactions ?? [])
      .filter((r) => r.pricePerSqftMinor && Number(r.pricePerSqftMinor) > 0)
      .map((r) => Number(r.pricePerSqftMinor) / 100);
    return median(vals);
  }, [transactions]);

  if (deduped.length === 0 && priceHistory.length === 0) {
    return (
      <section aria-labelledby="price-history-heading">
        <h2 id="price-history-heading" className="font-display text-xl font-semibold">
          {t("property.history.title", locale)}
        </h2>
        <p className="mt-3">
          <UnavailableValue label={t("property.history.none", locale)} />
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="price-history-heading">
      <h2 id="price-history-heading" className="font-display text-xl font-semibold">
        {t("property.history.title", locale)}
      </h2>

      {/* ============ 1. Asking price history (this listing) ============ */}
      <div className="mt-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("property.history.asking", locale)}
          </p>
          {last && prev && (
            <span
              className={cn(
                "num inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                Number(last.priceMinor) >= Number(prev.priceMinor)
                  ? "bg-success/10 text-success-foreground"
                  : "bg-destructive/10 text-destructive"
              )}
            >
              {Number(last.priceMinor) > Number(prev.priceMinor) ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              ) : Number(last.priceMinor) < Number(prev.priceMinor) ? (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Minus className="h-3.5 w-3.5" aria-hidden />
              )}
              {last.pctChange !== null ? formatPctPrecise(Math.abs(last.pctChange)) : t("property.history.noPct", locale)}{" "}
              {t("property.history.latestChange", locale)}
            </span>
          )}
        </div>

        {chartData.length >= 2 && (
          <div className="mt-3 h-44 w-full" role="img" aria-label={t("property.history.chartAria", locale)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }} tickLine={CHART_AXIS.axisTickLine} axisLine={CHART_AXIS.axisLine} dy={4} />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  cursor={CHART_CURSOR}
                  formatter={(value: number | string) => [formatAEDPrecise(Number(value)), t("property.history.price", locale)]}
                  labelFormatter={(_, payload) => (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ""}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Bar dataKey="price" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {chartData.map((d, i) => (
                    <Cell key={d.label + i} fill={i === chartData.length - 1 ? CHART_SEMANTIC.focus : CHART_COLORS[0]} fillOpacity={i === chartData.length - 1 ? 1 : 0.45} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Asking history table (deduplicated) */}
        <div className="mt-4 -mx-4 overflow-x-safe px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{t("property.history.tableCaption", locale)}</caption>
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.date", locale)}</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.price", locale)}</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.change", locale)}</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.pct", locale)}</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.source", locale)}</th>
                <th scope="col" className="py-2.5 font-medium">{t("property.history.state", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {deduped
                .slice()
                .reverse()
                .map((p) => {
                  const abs = p.absChangeMinor !== null ? Number(p.absChangeMinor) / 100 : null;
                  return (
                    <tr key={p.date + p.priceMinor} className="border-b border-border/40 last:border-0">
                      <td className="py-2.5 pr-3 text-muted-foreground">{formatDate(p.date)}</td>
                      <td className="num py-2.5 pr-3 font-medium" title={fullValueTooltip(Number(p.priceMinor) / 100)}>
                        {formatAEDPrecise(Number(p.priceMinor) / 100)}
                      </td>
                      <td className="num py-2.5 pr-3">
                        {abs === null ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : abs === 0 ? (
                          <span className="text-muted-foreground">{t("property.history.unchanged", locale)}</span>
                        ) : (
                          <span className={abs > 0 ? "text-success-foreground" : "text-destructive"}>
                            {abs > 0 ? "+" : "−"}
                            {formatAEDPrecise(Math.abs(abs))}
                          </span>
                        )}
                      </td>
                      <td className="num py-2.5 pr-3">
                        {p.pctChange === null ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : (
                          <span className={p.pctChange >= 0 ? "text-success-foreground" : "text-destructive"}>
                            {p.pctChange >= 0 ? "+" : "−"}
                            {formatPctPrecise(Math.abs(p.pctChange))}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs capitalize text-muted-foreground">{humanizeEnum(p.sourceType) || "—"}</td>
                      <td className="py-2.5">
                        <DataStateBadge state={pricePointState(p.sourceType, isDemoData)} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("property.history.askingNote", locale)}
          {droppedCount > 0 && (
            <>
              {" "}
              <span className="num">{droppedCount}</span> {t("property.history.dedupeNote", locale)}
            </>
          )}
        </p>
      </div>

      {/* ============ 2. Transaction context (community comparables) ============ */}
      <div className="section-contrast mt-4 rounded-xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("property.history.transactions", locale)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("property.history.transactionsNote", locale)}</p>

        {transactions === null ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("common.loading", locale)}</p>
        ) : comparables.length === 0 ? (
          <p className="mt-3">
            <UnavailableValue label={t("property.history.noTransactions", locale)} />
          </p>
        ) : (
          <>
            <div className="mt-3 -mx-4 overflow-x-safe px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">{t("property.history.compsCaption", locale)}</caption>
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.date", locale)}</th>
                    <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.type", locale)}</th>
                    <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.size", locale)}</th>
                    <th scope="col" className="py-2.5 pr-3 font-medium">{t("property.history.price", locale)}</th>
                    <th scope="col" className="py-2.5 font-medium">AED/sqft</th>
                  </tr>
                </thead>
                <tbody>
                  {comparables.map((c) => (
                    <tr key={c.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2.5 pr-3 text-muted-foreground">{formatDate(c.transactionDate)}</td>
                      <td className="py-2.5 pr-3 capitalize">{c.propertyType.toLowerCase()}{c.projectName ? ` · ${c.projectName}` : ""}</td>
                      <td className="num py-2.5 pr-3 text-muted-foreground">
                        {c.sizeSqft ? `${Math.round(c.sizeSqft).toLocaleString("en-US")} sqft` : "—"}
                      </td>
                      <td className="num py-2.5 pr-3 font-medium" title={fullValueTooltip(Number(c.amountMinor) / 100)}>
                        {formatAEDPrecise(Number(c.amountMinor) / 100)}
                      </td>
                      <td className="num py-2.5">
                        {c.pricePerSqftMinor ? (
                          <span className="inline-flex items-center gap-2">
                            {formatAEDPrecise(Number(c.pricePerSqftMinor) / 100)}
                            <DataStateBadge state={c.state} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">{t("property.history.medianPsqft", locale)}: </span>
              <span className="num font-semibold" title={communityMedianPsqft ? fullValueTooltip(communityMedianPsqft) : undefined}>
                {communityMedianPsqft !== null ? formatAEDPrecise(communityMedianPsqft) : <UnavailableValue />}
              </span>
              <span className="ml-1 text-xs text-muted-foreground">
                ({transactions.length} {t("property.history.observed", locale)})
              </span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}

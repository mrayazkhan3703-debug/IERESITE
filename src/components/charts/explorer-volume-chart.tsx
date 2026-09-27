"use client";

import * as React from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ProvenanceBadge } from "@/components/common";
import { Link } from "@/lib/router";
import { formatMoney, formatNumber } from "@/lib/money";
import { CHART_AXIS, CHART_COLORS, CHART_CURSOR, CHART_TOOLTIP_STYLE } from "@/lib/chart-theme";
import { t, localeOf } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { Sparkles } from "lucide-react";

export interface ExplorerSeriesPoint {
  /** "YYYY-MM" */
  month: string;
  count: number;
  avgAmountMinor: string | null;
  /** U10 (§19.4) additive: monthly median — enables the median/average toggle. */
  medianAmountMinor?: string | null;
}

export type ExplorerStatMode = "median" | "average";

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return new Intl.DateTimeFormat("en-AE", { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
}

/**
 * Monthly volume + price-statistic chart for the market data explorers
 * (transactions and rental contracts). Bars show record volume per month;
 * the line tracks the selected statistic (median or average) on a right
 * axis. Chart-theme tokens throughout; provenance-labeled.
 */
export function ExplorerVolumeChart({
  series,
  variant,
  isIllustrative,
  statMode = "average",
  action,
}: {
  series: ExplorerSeriesPoint[];
  variant: "transactions" | "rents";
  isIllustrative: boolean;
  /** §19.4 median vs average toggle — which price statistic the line shows. */
  statMode?: ExplorerStatMode;
  /** Optional header action (e.g. the per-chart Source drawer button). */
  action?: React.ReactNode;
}) {
  const isTx = variant === "transactions";
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const hasMedian = series.some((p) => p.medianAmountMinor !== null && p.medianAmountMinor !== undefined);
  const effectiveMode: ExplorerStatMode = statMode === "median" && hasMedian ? "median" : "average";

  const data = React.useMemo(
    () =>
      (series ?? [])
        .slice()
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((p) => ({
          ...p,
          label: monthLabel(p.month),
          avg: p.avgAmountMinor !== null && p.avgAmountMinor !== undefined ? Number(p.avgAmountMinor) : null,
          median: p.medianAmountMinor !== null && p.medianAmountMinor !== undefined ? Number(p.medianAmountMinor) : null,
        })),
    [series]
  );

  if (data.length < 2) return null;

  const totalRecords = data.reduce((s, p) => s + p.count, 0);
  const statPoints = data.filter((p) => (effectiveMode === "median" ? p.median !== null : p.avg !== null));
  const statOverall =
    statPoints.length > 0
      ? statPoints.reduce((s, p) => s + (effectiveMode === "median" ? (p.median ?? 0) : (p.avg ?? 0)), 0) / statPoints.length
      : null;

  const statLabel = isTx ? "sale price" : "annual rent";
  const lineName = `${effectiveMode === "median" ? "Median" : "Average"} ${statLabel}`;

  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">
            {isTx ? "Transaction volume & price trend" : "Rental contract volume & rent trend"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trailing {data.length} months · {formatNumber(totalRecords)} records in view
            {statOverall !== null
              ? ` · ${effectiveMode} ${statLabel} ${formatMoney(String(Math.round(statOverall)), { compact: true })}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {/* V3-F §20 — contextual entry: ask the advisor to explain this trend
              (prefilled ?q=; the user reviews and sends). */}
          <Link
            to="/advisor"
            query={{ q: `Explain the ${isTx ? "transaction volume and price" : "rental contract volume and rent"} trend for the current filter — what moved and what should I watch?` }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft/50 px-3 py-1.5 text-xs font-medium text-brand-strong transition-ui hover:border-brand/50 hover:bg-brand-soft sm:min-h-0"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("market.chart.askAi", locale)}
          </Link>
          <span className="num rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
            monthly aggregate
          </span>
          <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative }} />
        </div>
      </div>

      <div className="mt-4 h-60 w-full" role="img" aria-label={`Monthly ${isTx ? "transaction volume and price" : "rental contract volume and rent"} chart — ${lineName}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="explorerVolumeBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS[1]} stopOpacity={0.55} />
                <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }} tickLine={CHART_AXIS.axisTickLine} axisLine={CHART_AXIS.axisLine} dy={4} />
            <YAxis
              yAxisId="volume"
              allowDecimals={false}
              tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              width={36}
            />
            <YAxis
              yAxisId="amount"
              orientation="right"
              tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatMoney(String(Math.round(v)), { compact: true })}
            />
            <Tooltip
              cursor={CHART_CURSOR}
              formatter={(value: number | string, name: string) => {
                const n = Number(value);
                if (name === "Volume") return [formatNumber(n), name];
                return [formatMoney(String(Math.round(n)), { compact: false }), lineName];
              }}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar
              yAxisId="volume"
              dataKey="count"
              name="Volume"
              fill="url(#explorerVolumeBar)"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            />
            <Line
              yAxisId="amount"
              type="monotone"
              dataKey={effectiveMode === "median" ? "median" : "avg"}
              name={lineName}
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-card)", stroke: CHART_COLORS[0], strokeWidth: 1.5 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {isTx
          ? "Monthly aggregates of recorded sale transactions. Illustrative fixtures pending the DLD transactions import; production rows carry per-record source and retrieval timestamps."
          : "Monthly aggregates of recorded rental contracts. Illustrative fixtures pending the DLD rents import — these feed the yield calculators once live."}
      </p>
    </div>
  );
}

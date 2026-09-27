"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ProvenanceBadge } from "@/components/common";
import { formatMoney, formatNumber } from "@/lib/money";

export interface TrendPoint {
  metricKey: string;
  periodStart: string;
  valueNumeric: number;
  unit: string;
  isIllustrative: boolean;
  sourceName: string;
}

function quarterLabel(iso: string): string {
  const d = new Date(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${String(d.getFullYear()).slice(2)}`;
}

/**
 * Community market-trend visualization (recharts).
 * Price per sqft trend (area) and gross yield trend (dashed line, right axis).
 * All values carry provenance — illustrative fixtures are labeled as such.
 */
export function MarketTrendChart({ metrics, currency = "AED" }: { metrics: TrendPoint[]; currency?: string }) {
  const byPeriod = React.useMemo(() => {
    // Dedupe by quarter (multiple seed runs produce near-identical periodStart timestamps) — keep the latest per quarter
    const byQuarter = new Map<string, { periodStart: string; price?: number; yield?: number }>();
    for (const m of metrics) {
      if (m.metricKey !== "AVG_PRICE_PER_SQFT" && m.metricKey !== "YIELD_PCT") continue;
      const qLabel = quarterLabel(m.periodStart);
      const e = byQuarter.get(qLabel) ?? { periodStart: m.periodStart };
      if (m.periodStart > e.periodStart) e.periodStart = m.periodStart;
      if (m.metricKey === "AVG_PRICE_PER_SQFT") e.price = m.valueNumeric;
      else e.yield = m.valueNumeric;
      byQuarter.set(qLabel, e);
    }
    return Array.from(byQuarter.values())
      .filter((p) => p.price !== undefined)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
      .map((p) => ({ ...p, label: quarterLabel(p.periodStart) }));
  }, [metrics]);

  if (byPeriod.length < 2) return null;

  const hasYield = byPeriod.some((p) => p.yield !== undefined);
  const illustrative = metrics.some((m) => m.isIllustrative);
  const first = byPeriod[0].price ?? 0;
  const last = byPeriod[byPeriod.length - 1].price ?? 0;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Price & yield trend</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trailing {byPeriod.length} quarters · avg price per sqft{hasYield ? " · gross yield" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`num rounded-full px-2.5 py-1 text-xs font-semibold ${
              changePct >= 0 ? "bg-success/10 text-success-foreground" : "bg-destructive/10 text-destructive"
            }`}
          >
            {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% over period
          </span>
          <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: illustrative }} />
        </div>
      </div>

      <div className="mt-4 h-64 w-full" role="img" aria-label="Community price per square foot and yield trend chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={byPeriod} margin={{ top: 4, right: hasYield ? 4 : 12, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="trendPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} dy={4} />
            <YAxis
              yAxisId="price"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatNumber(Math.round(v / 100)) + "00"}
            />
            {hasYield && (
              <YAxis
                yAxisId="yield"
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              />
            )}
            <Tooltip
              formatter={(value: number | string, name: string) => {
                const n = Number(value);
                if (name === "Yield") return [`${n.toFixed(1)}%`, name];
                return [formatMoney(String(Math.round(n * 100)), { currency, compact: false }), "Price / sqft"];
              }}
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                fontSize: "12px",
                color: "var(--color-foreground)",
              }}
            />
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="price"
              name="Price / sqft"
              stroke="var(--color-brand)"
              strokeWidth={2}
              fill="url(#trendPrice)"
              dot={{ r: 3, fill: "var(--color-brand)", strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
            {hasYield && (
              <Area
                yAxisId="yield"
                type="monotone"
                dataKey="yield"
                name="Yield"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                fill="transparent"
                dot={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Illustrative fixture series pending the DLD open-data import — methodology and source shown per metric in the
        table below. Past performance is not a guarantee of future results.
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRoute } from "@/lib/router";
import { localeOf } from "@/lib/i18n";
import { calculatorCopy } from "@/lib/calculator-copy";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatMoney } from "@/lib/money";

export interface RoiProjectionPoint {
  year: number;
  /** Cumulative net rental income by end of year (AED) */
  rentalIncome: number;
  /** Capital appreciation vs purchase price by end of year (AED, may be negative) */
  appreciation: number;
}

/**
 * ROI scenario projection (recharts) — stacked composition of total return:
 * cumulative net rental income + capital appreciation at the user's assumption.
 * Pure deterministic function of the calculator inputs; scenario-labeled.
 */
export function RoiProjectionChart({
  points,
  purchasePrice,
}: {
  points: RoiProjectionPoint[];
  purchasePrice: number;
}) {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const data = React.useMemo(
    () =>
      points.map((p) => ({
        ...p,
        label: p.year === 0 ? c("Buy") : `${c("Yr")} ${p.year}`,
        total: p.rentalIncome + p.appreciation,
      })),
    [points, c]
  );

  if (data.length < 2) return null;

  const hasNegative = data.some((p) => p.appreciation < 0);

  return (
    <div className="rounded-xl border border-brand/25 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{c("Return composition over time")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {c("Cumulative net rental income + capital appreciation at your assumption · purchase")}{" "}
            {formatMoney(String(Math.round(purchasePrice) * 100), { currency: "AED", compact: true })}
          </p>
        </div>
        <span className="num rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info">{c("scenario")}</span>
      </div>

      <div className="mt-4 h-56 w-full" role="img" aria-label={c("Stacked area chart of cumulative rental income and capital appreciation by year")}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="roiRental" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.15} />
              </linearGradient>
              <linearGradient id="roiAppreciation" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} dy={4} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={hasNegative ? ["auto", "auto"] : [0, "auto"]}
              tickFormatter={(v: number) => formatMoney(String(Math.round(v) * 100), { currency: "AED", compact: true })}
            />
            <Tooltip
              formatter={(value: number | string, name: string) => {
                const n = Number(value);
                const label = name === c("Rental income") ? c("Rental income (cum.)") : name === c("Appreciation") ? c("Appreciation") : c("Total return");
                return [formatMoney(String(Math.round(n) * 100), { currency: "AED", compact: true }), label];
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
              type="monotone"
              dataKey="rentalIncome"
              name={c("Rental income")}
              stackId="return"
              stroke="var(--color-brand)"
              strokeWidth={1.5}
              fill="url(#roiRental)"
            />
            <Area
              type="monotone"
              dataKey="appreciation"
              name={c("Appreciation")}
              stackId="return"
              stroke="var(--color-success)"
              strokeWidth={1.5}
              fill="url(#roiAppreciation)"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand/60" aria-hidden /> {c("Rental income")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-success/50" aria-hidden /> {c("Appreciation (assumption)")}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {c("Deterministic projection from your inputs. Appreciation compounds annually at your stated assumption — historical growth is not a forecast, and total return is a scenario, not a guaranteed outcome.")}
      </p>
    </div>
  );
}

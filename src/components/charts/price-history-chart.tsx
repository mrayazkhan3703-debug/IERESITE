"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { formatMoney } from "@/lib/money";

export interface PricePoint {
  priceMinor: string;
  recordedAt: string;
  sourceType: string;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/**
 * Listing price-history visualization (recharts bars) — replaces the plain table
 * as primary display; exact values remain in the adjacent table.
 */
export function PriceHistoryChart({ points, currency = "AED" }: { points: PricePoint[]; currency?: string }) {
  const data = React.useMemo(
    () =>
      points
        .slice()
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
        .map((p) => ({
          label: dateLabel(p.recordedAt),
          price: Number(p.priceMinor) / 100,
          recordedAt: p.recordedAt,
        })),
    [points]
  );

  if (data.length < 2) return null;

  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const changePct = prev.price > 0 ? ((last.price - prev.price) / prev.price) * 100 : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recorded asking prices</p>
        <span
          className={`num rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            changePct >= 0 ? "bg-success/10 text-success-foreground" : "bg-destructive/10 text-destructive"
          }`}
        >
          {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% latest change
        </span>
      </div>
      <div className="mt-3 h-40 w-full" role="img" aria-label="Price history bar chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} dy={4} />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.25 }}
              formatter={(value: number | string) => [formatMoney(String(Math.round(Number(value) * 100)), { currency }), "Price"]}
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                fontSize: "12px",
                color: "var(--color-foreground)",
              }}
            />
            <Bar dataKey="price" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {data.map((d, i) => (
                <Cell key={d.recordedAt} fill={i === data.length - 1 ? "var(--color-brand)" : "color-mix(in oklab, var(--color-brand) 45%, transparent)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Asking-price history as recorded on this listing — not verified transaction data.
      </p>
    </div>
  );
}

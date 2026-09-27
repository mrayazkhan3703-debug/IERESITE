"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";
import { ProvenanceBadge } from "@/components/common";
import { formatMoney } from "@/lib/money";

interface LatestMetric {
  id: string;
  community: { id: string; name: string; slug: string };
  metricKey: string;
  valueNumeric: number;
  unit: string;
  isIllustrative: boolean;
}

/**
 * Cross-community comparison (market hub): latest avg price per sqft as horizontal
 * bars, colored by tier; links through to community pages.
 */
export function CommunityCompareChart({ metrics }: { metrics: LatestMetric[] }) {
  const data = React.useMemo(
    () =>
      metrics
        .filter((m) => m.metricKey === "AVG_PRICE_PER_SQFT")
        .map((m) => ({
          name: m.community.name,
          slug: m.community.slug,
          price: m.valueNumeric,
        }))
        .sort((a, b) => b.price - a.price),
    [metrics]
  );

  if (data.length < 2) return null;

  const yieldsBySlug = new Map<string, number>();
  for (const m of metrics) {
    if (m.metricKey === "YIELD_PCT") yieldsBySlug.set(m.community.slug, m.valueNumeric);
  }
  const illustrative = metrics.some((m) => m.isIllustrative);

  const colorFor = (price: number) => {
    const max = data[0].price;
    const ratio = price / max;
    if (ratio > 0.8) return "var(--color-brand-strong)";
    if (ratio > 0.45) return "var(--color-brand)";
    return "color-mix(in oklab, var(--color-brand) 55%, var(--color-muted))";
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Where prices stand across Dubai</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Average price per sqft by community · latest period on record</p>
        </div>
        <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: illustrative }} />
      </div>

      <div className="mt-4 h-auto w-full" style={{ height: data.length * 44 + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} horizontal={false} />
            <XAxis type="number" hide domain={[0, "dataMax + dataMax * 0.08"]} />
            <YAxis
              type="category"
              dataKey="name"
              width={132}
              tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.25 }}
              formatter={(value: number | string) => [
                formatMoney(String(Math.round(Number(value) * 100)), { currency: "AED" }),
                "Avg price / sqft",
              ]}
              labelFormatter={(label: string) => {
                const d = data.find((x) => x.name === label);
                const y = d && yieldsBySlug.get(d.slug);
                return y !== undefined ? `${label} · gross yield ${y.toFixed(1)}%` : label;
              }}
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                fontSize: "12px",
                color: "var(--color-foreground)",
              }}
            />
            <Bar dataKey="price" radius={[0, 6, 6, 0]} maxBarSize={26}>
              {data.map((d) => (
                <Cell key={d.slug} fill={colorFor(d.price)} />
              ))}
              <LabelList
                dataKey="price"
                position="right"
                formatter={(value: number) => formatMoney(String(Math.round(value * 100)), { currency: "AED", compact: true })}
                style={{ fontSize: 11, fill: "var(--color-muted-foreground)", fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {data.map((d) => {
          const y = yieldsBySlug.get(d.slug);
          return (
            <Link key={d.slug} to={`/communities/${d.slug}`} className="transition-ui hover:text-foreground">
              {d.name}
              {y !== undefined && <span className="num"> · {y.toFixed(1)}% yield</span>}
            </Link>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Illustrative fixture values pending the DLD open-data import; per-community methodology is shown on each
        community page. Figures are not investment advice.
      </p>
    </div>
  );
}

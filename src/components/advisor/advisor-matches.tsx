"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { Link } from "@/lib/router";
import { formatMoney, formatNumber } from "@/lib/money";
import { BedDouble, ArrowRight, MapPin, Building2 } from "lucide-react";

export interface AdvisorMatchCard {
  slug: string;
  title: string;
  community: string;
  project: string | null;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceAed: number;
  availability: string;
  offPlan: boolean;
}

/**
 * Structured inventory matches returned by the AI advisor's search tool —
 * rendered as result cards plus a compact price-comparison bar chart.
 * Grounded in real inventory only (R12): every card links to the live listing.
 */
export function AdvisorMatches({ matches }: { matches: AdvisorMatchCard[] }) {
  if (!matches || matches.length === 0) return null;

  const chartData = matches.map((m, i) => ({
    name: m.title.length > 22 ? `${m.title.slice(0, 21)}…` : m.title,
    short: `#${i + 1}`,
    price: m.priceAed,
  }));

  const lowest = matches.reduce((min, m) => (m.priceAed < min.priceAed ? m : min), matches[0]);

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-sand/30 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Matching inventory · {matches.length} live {matches.length === 1 ? "listing" : "listings"}
        </p>
        <span className="text-[10px] text-muted-foreground">verified in-tool · no invention</span>
      </div>

      {/* Result cards */}
      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {matches.map((m, i) => (
          <li key={m.slug}>
            <Link
              to={`/properties/${m.slug}`}
              className="group flex h-full flex-col justify-between rounded-lg border border-border/60 bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-brand-strong">
                  <span className="num mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                  {m.title}
                </p>
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-brand" aria-hidden />{m.community}</span>
                <span className="num inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 text-brand" aria-hidden />{m.bedrooms === 0 ? "Studio" : `${m.bedrooms} bed`}</span>
                {m.areaSqft && <span className="num">{formatNumber(m.areaSqft)} sqft</span>}
                {m.project && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3 text-brand" aria-hidden />{m.project}</span>}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="num text-sm font-semibold">
                  {formatMoney(String(Math.round(m.priceAed * 100)), { currency: "AED", compact: true })}
                </p>
                {m.priceAed === lowest.priceAed && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success-foreground">
                    lowest of set
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Compact price chart */}
      {chartData.length >= 2 && (
        <div className="mt-3 rounded-lg border border-border/60 bg-card p-2.5">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Price comparison (AED)
          </p>
          <div className="mt-1 h-24 w-full" role="img" aria-label="Bar chart comparing matched listing prices">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  dy={2}
                />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip
                  cursor={{ fill: "var(--color-sand)", fillOpacity: 0.5 }}
                  formatter={(value: number | string) => [formatMoney(String(Math.round(Number(value) * 100)), { compact: false }), "Asking price"]}
                  labelFormatter={(label: string) => {
                    const item = chartData.find((c) => c.short === label);
                    return item ? item.name : label;
                  }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "10px",
                    fontSize: "12px",
                    color: "var(--color-foreground)",
                  }}
                />
                <Bar dataKey="price" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={matches[i].priceAed === lowest.priceAed ? "var(--color-success)" : "var(--color-brand)"}
                      fillOpacity={matches[i].priceAed === lowest.priceAed ? 0.85 : 0.55}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

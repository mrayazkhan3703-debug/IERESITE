"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { formatNumber } from "@/lib/money";
import { ProvenanceBadge } from "@/components/common";

export interface HeatmapMetric {
  id: string;
  community: { id: string; name: string; slug: string };
  metricKey: string;
  valueNumeric: number;
  unit: string;
  isIllustrative: boolean;
}

/** Column definitions: label, key, format, direction (+1 = high is "hot"), color family. */
const COLUMNS: Array<{ key: string; label: string; short: string; dir: 1 | -1; family: "brand" | "success" | "sand" }> = [
  { key: "AVG_PRICE_PER_SQFT", label: "Avg price / sqft", short: "AED/sqft", dir: 1, family: "brand" },
  { key: "MEDIAN_TRANS_PRICE", label: "Median sale price", short: "AED", dir: 1, family: "brand" },
  { key: "AVG_RENT_1BR", label: "Avg 1BR rent / yr", short: "AED/yr", dir: 1, family: "brand" },
  { key: "YIELD_PCT", label: "Gross yield", short: "%", dir: 1, family: "success" },
  { key: "TRANSACTION_COUNT", label: "Transactions (period)", short: "count", dir: 1, family: "sand" },
];

const FAMILY_CLASSES: Record<string, { low: string; high: string; text: string }> = {
  brand: { low: "bg-transparent", high: "bg-brand/25", text: "text-foreground" },
  success: { low: "bg-transparent", high: "bg-success/25", text: "text-foreground" },
  sand: { low: "bg-transparent", high: "bg-sand", text: "text-foreground" },
};

/** Community × metric heatmap table — relative intensity within each column, values with units. */
export function MarketHeatmapTable({ metrics }: { metrics: HeatmapMetric[] }) {
  // Group: community (first-seen order) → metricKey → value
  const rows = React.useMemo(() => {
    const order: string[] = [];
    const byCommunity = new Map<string, { name: string; slug: string; values: Map<string, HeatmapMetric> }>();
    for (const m of metrics) {
      if (!byCommunity.has(m.community.slug)) {
        byCommunity.set(m.community.slug, { name: m.community.name, slug: m.community.slug, values: new Map() });
        order.push(m.community.slug);
      }
      byCommunity.get(m.community.slug)!.values.set(m.metricKey, m);
    }
    return order.map((slug) => byCommunity.get(slug)!);
  }, [metrics]);

  // Column min/max for intensity scaling
  const scale = React.useMemo(() => {
    const s = new Map<string, { min: number; max: number }>();
    for (const col of COLUMNS) {
      const vals = rows.map((r) => r.values.get(col.key)?.valueNumeric).filter((v): v is number => typeof v === "number");
      if (vals.length > 0) s.set(col.key, { min: Math.min(...vals), max: Math.max(...vals) });
    }
    return s;
  }, [rows]);

  if (rows.length === 0) return null;

  const intensity = (key: string, value: number): number => {
    const sc = scale.get(key);
    if (!sc || sc.max === sc.min) return 0.15;
    return 0.15 + (0.85 * (value - sc.min)) / (sc.max - sc.min);
  };

  const cellStyle = (col: (typeof COLUMNS)[number], value: number | undefined): React.CSSProperties | undefined => {
    if (value === undefined) return undefined;
    const alpha = intensity(col.key, value) * (col.family === "sand" ? 0.7 : 0.3);
    const color = col.family === "success" ? "var(--color-success)" : col.family === "sand" ? "var(--color-sand)" : "var(--color-brand)";
    return { backgroundColor: `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)` };
  };

  return (
    <div className="overflow-x-safe rounded-xl border border-border/70">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Community metrics heatmap — cell shading shows relative position within each column (darker = higher)</caption>
        <thead>
          <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="p-3.5 font-medium">Community</th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="p-3.5 text-right font-medium">
                {c.label}
                <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">({c.short})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug} className="border-b border-border/40 transition-colors last:border-0 hover:bg-sand/30">
              <th scope="row" className="p-3.5 text-left font-medium">
                <Link to={`/communities/${r.slug}`} className="transition-ui hover:text-brand-strong">
                  {r.name}
                </Link>
              </th>
              {COLUMNS.map((c) => {
                const m = r.values.get(c.key);
                return (
                  <td key={c.key} className="num p-3.5 text-right font-medium tabular-nums" style={cellStyle(c, m?.valueNumeric)}>
                    {m ? (
                      <span title={`${c.label} for ${r.name}: ${formatNumber(m.valueNumeric)} ${m.unit}`}>
                        {c.key === "YIELD_PCT" ? `${formatNumber(m.valueNumeric, undefined, { maximumFractionDigits: 1 })}%` : formatNumber(m.valueNumeric)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50" title="No data">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-sand/30 px-3.5 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          Shading is relative within each column (darker = higher). Values carry their own provenance — illustrative fixtures are labeled.
        </p>
        {metrics[0] && <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative: metrics[0].isIllustrative }} />}
      </div>
    </div>
  );
}

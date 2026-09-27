"use client";

/**
 * Price/rent distribution histogram (U10 §19.4/§19.5) — valid records per
 * bucket, computed server-side over the same filtered validated rows as every
 * other explorer surface. Chart-theme tokens; sr-only text alternative.
 */

import * as React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import { CHART_AXIS, CHART_COLORS, CHART_CURSOR, CHART_TOOLTIP_STYLE } from "@/lib/chart-theme";
import { formatMoney, formatNumber } from "@/lib/money";
import { ChartCard } from "./chart-card";
import { SourceDialogButton } from "./source-dialog";
import { useElementWidth } from "@/hooks/use-element-width";
import type { MarketDistributionBucket, SourceInfo } from "./market-types";

export function DistributionChart({
  buckets,
  variant,
  source,
}: {
  buckets: MarketDistributionBucket[];
  variant: "transactions" | "rents";
  source: SourceInfo;
}) {
  const isTx = variant === "transactions";
  /* V3-F §40 tick density: thin bucket labels so they never overlap on narrow
   * screens — angled 10.5px labels need ~74px each, so only every Nth tick
   * renders below ~52px/bucket. Full labels stay available via the tooltip. */
  const { ref: chartBoxRef, width: chartWidth } = useElementWidth<HTMLDivElement>();
  const data = React.useMemo(
    () =>
      buckets.map((b) => ({
        label: b.label,
        count: b.count,
        from: Number(b.fromMinor) / 100,
        to: b.toMinor !== null ? Number(b.toMinor) / 100 : null,
      })),
    [buckets]
  );

  if (data.length === 0) return null;

  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  const bucketValueLabel = (d: { from: number; to: number | null }) =>
    `${formatMoney(String(Math.round(d.from * 100)), { currency: "AED", compact: true })}${
      d.to !== null ? ` – ${formatMoney(String(Math.round(d.to * 100)), { currency: "AED", compact: true })}` : "+"
    }`;

  /* How many bucket labels fit without overlap (~95px per angled label incl. spacing). */
  const labelBudgetPx = 95;
  const ticksThatFit = chartWidth !== null ? Math.max(2, Math.floor(chartWidth / labelBudgetPx)) : data.length;
  const tickInterval = data.length > ticksThatFit ? Math.ceil(data.length / ticksThatFit) - 1 : 0;

  return (
    <ChartCard
      title={isTx ? "Price distribution" : "Rent distribution"}
      description={`${formatNumber(total)} validated records across ${data.length} ${isTx ? "price" : "rent"} buckets`}
      action={<SourceDialogButton info={source} />}
      askAiQuery={`Explain the ${isTx ? "sale price" : "annual rent"} distribution for the current filter — which bucket should I care about and why?`}
      srSummary={`Histogram of ${isTx ? "sale prices" : "annual rents"}: ${data
        .map((d) => `${bucketValueLabel(d)}: ${d.count} records`)
        .join("; ")}. Peak bucket ${bucketValueLabel(peak)} with ${peak.count} records.`}
    >
      <div ref={chartBoxRef} className="h-56 w-full" role="img" aria-label={`${isTx ? "Price" : "Rent"} distribution histogram`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10.5, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              dy={4}
              interval={tickInterval}
              angle={-18}
              textAnchor="end"
              height={44}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              width={34}
            />
            <Tooltip
              cursor={CHART_CURSOR}
              formatter={(value: number | string) => [`${formatNumber(Number(value))} records`, "Records"]}
              labelFormatter={(_, payload) => {
                const d = payload?.[0]?.payload as { from: number; to: number | null } | undefined;
                return d ? bucketValueLabel(d) : "";
              }}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar dataKey="count" name="Records" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={48}>
              <LabelList
                dataKey="count"
                position="top"
                style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Equal-width buckets over the observed range of the current filter — the same validated records that feed the
        table below. Records without a usable value are excluded rather than estimated.
      </p>
    </ChartCard>
  );
}

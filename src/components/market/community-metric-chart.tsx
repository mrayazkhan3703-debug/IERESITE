"use client";

/**
 * Community comparison charts (U10 §19.6) — one synchronized bar chart per
 * metric over the SAME 2–4 selected communities. Every chart in the group
 * receives the identical selection, so switching a community updates all
 * charts at once. Chart-theme colors; sr-only text alternatives.
 */

import * as React from "react";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import { chartColor, CHART_AXIS, CHART_CURSOR, CHART_TOOLTIP_STYLE } from "@/lib/chart-theme";
import { formatMoney, formatNumber } from "@/lib/money";
import { ChartCard } from "./chart-card";
import { SourceDialogButton } from "./source-dialog";
import type { SourceInfo } from "./market-types";

export interface CommunityMetricDatum {
  name: string;
  /** Primary value (may be minor-units as a raw number, a percent, or a count). */
  value: number | null;
}

/** Value formatting modes for the comparison charts. */
export type MetricFormat = "aed" | "aedMinor" | "percent" | "count";

export function CommunityMetricChart({
  title,
  data,
  format,
  source,
  note,
}: {
  title: string;
  data: CommunityMetricDatum[];
  format: MetricFormat;
  source: SourceInfo;
  note?: string;
}) {
  const rows = data.filter((d) => d.value !== null);
  if (rows.length === 0) return null;

  const fmt = (v: number): string => {
    switch (format) {
      case "aed":
        return formatMoney(String(Math.round(v * 100)), { currency: "AED", compact: true });
      case "aedMinor":
        return formatMoney(String(Math.round(v)), { currency: "AED", compact: true });
      case "percent":
        return `${v.toFixed(2)}%`;
      case "count":
        return formatNumber(v);
    }
  };

  return (
    <ChartCard
      title={title}
      action={<SourceDialogButton info={source} />}
      askAiQuery={`Compare ${rows.map((d) => d.name).join(", ")} on ${title} — what should an investor take from the difference?`}
      srSummary={`${title} comparison: ${rows.map((d) => `${d.name} ${fmt(d.value as number)}`).join("; ")}.`}
      className="h-full"
    >
      <div className="h-44 w-full" role="img" aria-label={`${title} comparison bar chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              dy={6}
              interval={0}
            />
            <YAxis hide domain={[0, "dataMax + dataMax * 0.15"]} />
            <Tooltip
              cursor={CHART_CURSOR}
              formatter={(value: number | string) => [fmt(Number(value)), title]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar dataKey="value" name={title} radius={[5, 5, 0, 0]} maxBarSize={56}>
              {rows.map((d, i) => (
                <Cell key={d.name} fill={chartColor(i)} />
              ))}
            </Bar>
            <LabelList
              dataKey="value"
              position="top"
              formatter={(value: number) => fmt(value)}
              style={{ fontSize: 11, fill: "var(--color-foreground)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
    </ChartCard>
  );
}

/** Off-plan / ready project split (§19.6) — stacked bar per community. */
export function CommunitySplitChart({
  title,
  data,
  source,
}: {
  title: string;
  data: { name: string; offPlan: number; ready: number }[];
  source: SourceInfo;
}) {
  const rows = data.filter((d) => d.offPlan + d.ready > 0);
  if (rows.length === 0) return null;

  return (
    <ChartCard
      title={title}
      action={<SourceDialogButton info={source} />}
      askAiQuery={`Compare the off-plan versus ready supply split for ${rows.map((d) => d.name).join(", ")} — how should it affect timing a purchase?`}
      srSummary={`${title}: ${rows
        .map((d) => `${d.name} — ${d.offPlan} off-plan or under construction, ${d.ready} ready`)
        .join("; ")}.`}
      className="h-full"
    >
      <div className="space-y-3">
        {rows.map((d) => {
          const total = d.offPlan + d.ready;
          const offPct = (d.offPlan / total) * 100;
          return (
            <div key={d.name}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium">{d.name}</span>
                <span className="num shrink-0 text-muted-foreground">
                  {d.offPlan} / {d.ready} · {formatNumber(total)} projects
                </span>
              </div>
              <div
                className="mt-1 flex h-6 w-full overflow-hidden rounded-lg border border-border/60"
                role="presentation"
                aria-hidden="true"
              >
                <div className="h-full" style={{ width: `${offPct}%`, backgroundColor: chartColor(2) }} />
                <div className="h-full" style={{ width: `${100 - offPct}%`, backgroundColor: chartColor(3) }} />
              </div>
            </div>
          );
        })}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chartColor(2) }} aria-hidden="true" /> off-plan / under construction
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chartColor(3) }} aria-hidden="true" /> ready
          </span>
        </p>
      </div>
    </ChartCard>
  );
}

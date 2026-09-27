"use client";

/**
 * Entity market charts (U08 §16) — recharts visualizations styled with the V2
 * chart theme tokens (CHART_ constants from src/lib/chart-theme.ts).
 *
 * Two reusable shapes:
 *  - MetricTrendChart: quarterly metric series (e.g. avg price/sqft) with an
 *    optional secondary right-axis series (e.g. gross yield %).
 *  - MonthlySeriesChart: monthly observed records — bars for volume, a right-
 *    axis line for the average amount. Used by transaction and rent trends.
 *
 * All money labels go through formatAEDPrecise (§21.2) — no collapsing
 * abbreviations; full values ride tooltips via fullValueTooltip.
 */

import * as React from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Bar, Line } from "recharts";
import { CHART_AXIS, CHART_COLORS, CHART_CURSOR, CHART_TOOLTIP_STYLE, CHART_AREA_GRADIENT } from "@/lib/chart-theme";
import { formatAEDPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { monthLabel } from "./entity-shared";

export interface MetricTrendPoint {
  label: string;
  primary?: number;
  secondary?: number;
}

function QuarterTooltip({
  active,
  payload,
  labels,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; dataKey?: string | number; payload?: { label?: string } }[];
  labels: [string, string];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm" style={{ background: "var(--color-card)" }}>
      <p className="mb-1 font-semibold">{String(payload[0]?.payload?.label ?? "")}</p>
      {payload.map((p, i) => {
        const v = Number(p.value);
        const isPct = p.dataKey === "secondary";
        return (
          <p key={i} className="num flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: isPct ? CHART_COLORS[1] : CHART_COLORS[0] }} aria-hidden />
            {isPct ? labels[1] : labels[0]}:{" "}
            <span className="font-medium" title={isPct ? undefined : fullValueTooltip(v)}>
              {isPct ? `${v.toFixed(1)}%` : formatAEDPrecise(v)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

/** Quarterly metric trend (primary = money on left axis; secondary = % right axis). */
export function MetricTrendChart({
  points,
  labels,
  ariaLabel,
  height = 240,
}: {
  points: MetricTrendPoint[];
  labels: [string, string];
  ariaLabel: string;
  height?: number;
}) {
  if (points.length < 2) return null;
  const hasSecondary = points.some((p) => p.secondary !== undefined);
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: hasSecondary ? 2 : 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="entityTrendPrimary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_AREA_GRADIENT.from} stopOpacity={CHART_AREA_GRADIENT.fromOpacity} />
              <stop offset="100%" stopColor={CHART_AREA_GRADIENT.to} stopOpacity={CHART_AREA_GRADIENT.toOpacity} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }} tickLine={CHART_AXIS.axisTickLine} axisLine={CHART_AXIS.axisLine} dy={4} />
          <YAxis
            yAxisId="primary"
            tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
            tickLine={CHART_AXIS.axisTickLine}
            axisLine={CHART_AXIS.axisLine}
            width={64}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => (v >= 1000 ? `${formatNumber(Math.round(v / 1000))}k` : formatNumber(Math.round(v)))}
          />
          {hasSecondary && (
            <YAxis
              yAxisId="secondary"
              orientation="right"
              tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              width={40}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
          )}
          <Tooltip content={<QuarterTooltip labels={labels} />} />
          <Area
            yAxisId="primary"
            type="monotone"
            dataKey="primary"
            name={labels[0]}
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            fill="url(#entityTrendPrimary)"
            dot={{ r: 3, fill: CHART_COLORS[0], strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
          {hasSecondary && (
            <Area
              yAxisId="secondary"
              type="monotone"
              dataKey="secondary"
              name={labels[1]}
              stroke={CHART_COLORS[1]}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              fill="transparent"
              dot={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface MonthlySeriesPoint {
  month: string;
  count: number;
  avgMajor: number;
}

function MonthlyTooltip({ active, payload, unitLabel }: { active?: boolean; payload?: { payload?: MonthlySeriesPoint }[]; unitLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div style={CHART_TOOLTIP_STYLE} className="px-3 py-2 text-xs">
      <p className="mb-1 font-semibold">{monthLabel(p.month)}</p>
      <p className="num">
        {formatNumber(p.count)} {p.count === 1 ? "record" : "records"}
      </p>
      <p className="num">
        {unitLabel}: <span className="font-medium" title={fullValueTooltip(p.avgMajor)}>{formatAEDPrecise(p.avgMajor)}</span>
      </p>
    </div>
  );
}

/** Monthly observed records — volume bars + average-amount line (right axis). */
export function MonthlySeriesChart({
  points,
  unitLabel,
  ariaLabel,
  height = 220,
}: {
  points: MonthlySeriesPoint[];
  unitLabel: string;
  ariaLabel: string;
  height?: number;
}) {
  const data = points.map((p) => ({ ...p, label: monthLabel(p.month) }));
  if (data.length < 2) return null;
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }} tickLine={CHART_AXIS.axisTickLine} axisLine={CHART_AXIS.axisLine} dy={4} />
          <YAxis
            yAxisId="count"
            allowDecimals={false}
            tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
            tickLine={CHART_AXIS.axisTickLine}
            axisLine={CHART_AXIS.axisLine}
            width={30}
          />
          <YAxis
            yAxisId="avg"
            orientation="right"
            tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
            tickLine={CHART_AXIS.axisTickLine}
            axisLine={CHART_AXIS.axisLine}
            width={64}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => (v >= 1000 ? `${formatNumber(Math.round(v / 1000))}k` : formatNumber(Math.round(v)))}
          />
          <Tooltip content={<MonthlyTooltip unitLabel={unitLabel} />} cursor={{ ...CHART_CURSOR }} />
          <Bar yAxisId="count" dataKey="count" name="Records" fill={CHART_COLORS[2]} fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Line yAxisId="avg" type="monotone" dataKey="avgMajor" name={unitLabel} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 2.5, fill: CHART_COLORS[0], strokeWidth: 0 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Small horizontal distribution bar (type mix, supply split). */
export function DistributionBar({ segments, ariaLabel }: { segments: { label: string; value: number; color?: string }[]; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full"
      role="img"
      aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")}`}
    >
      {segments.map((s, i) => (
        <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }} title={`${s.label}: ${formatNumber(s.value)}`} />
      ))}
    </div>
  );
}

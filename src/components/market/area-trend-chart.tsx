"use client";

/**
 * Compare-areas trend lines (U10 §19.5) — monthly median per selected area
 * (2–4 lines, chart-theme categorical colors) over the SAME filtered record
 * set. Data comes from the API's areaSeries aggregation.
 */

import * as React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { chartColor, CHART_AXIS, CHART_TOOLTIP_STYLE } from "@/lib/chart-theme";
import { formatMoney, formatNumber } from "@/lib/money";
import { ChartCard } from "./chart-card";
import { SourceDialogButton } from "./source-dialog";
import type { MarketAreaSeries, SourceInfo } from "./market-types";

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return new Intl.DateTimeFormat("en-AE", { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
}

export function AreaTrendChart({
  areaSeries,
  selected,
  variant,
  source,
}: {
  areaSeries: MarketAreaSeries[];
  selected: string[];
  variant: "transactions" | "rents";
  source: SourceInfo;
}) {
  const isTx = variant === "transactions";

  const data = React.useMemo(() => {
    const byArea = new Map(areaSeries.filter((a) => selected.includes(a.areaName)).map((a) => [a.areaName, a]));
    const months = new Set<string>();
    for (const a of byArea.values()) for (const p of a.monthly) months.add(p.month);
    const sorted = Array.from(months).sort((a, b) => a.localeCompare(b));
    return sorted.map((month) => {
      const point: Record<string, number | string | null> = { month, label: monthLabel(month) };
      for (const a of byArea.values()) {
        const p = a.monthly.find((x) => x.month === month);
        point[a.areaName] = p && p.medianAmountMinor !== null ? Number(p.medianAmountMinor) : null;
      }
      return point;
    });
  }, [areaSeries, selected]);

  if (selected.length < 2 || data.length === 0) return null;

  const unitLabel = isTx ? "median price" : "median rent";

  return (
    <ChartCard
      title={isTx ? "Median price trend by area" : "Median rent trend by area"}
      description={`${selected.length} selected areas · monthly medians of the current filter`}
      action={<SourceDialogButton info={source} />}
      askAiQuery={`Explain the ${isTx ? "median price" : "median rent"} trend for ${selected.join(", ")} — which area is strengthening and why?`}
      srSummary={`${unitLabel} trends: ${selected.join(", ")} across ${data.length} months. Values in AED.`}
    >
      <div className="h-60 w-full" role="img" aria-label={`${unitLabel} trend lines for ${selected.join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }} tickLine={CHART_AXIS.axisTickLine} axisLine={CHART_AXIS.axisLine} dy={4} />
            <YAxis
              tick={{ fontSize: CHART_AXIS.axisTickFontSize, fill: CHART_AXIS.axisTickFill }}
              tickLine={CHART_AXIS.axisTickLine}
              axisLine={CHART_AXIS.axisLine}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatMoney(String(Math.round(v)), { compact: true })}
            />
            <Tooltip
              formatter={(value: number | string, name: string) => [
                formatMoney(String(Math.round(Number(value))), { compact: false }),
                name,
              ]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
            {selected.map((area, i) => (
              <Line
                key={area}
                type="monotone"
                dataKey={area}
                name={area}
                stroke={chartColor(i)}
                strokeWidth={2}
                dot={{ r: 2.5, fill: chartColor(i), strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Monthly medians computed over the same validated records as the table — {formatNumber(data.length)} months in
        view. Areas with a missing month show a gap rather than an interpolated value.
      </p>
    </ChartCard>
  );
}

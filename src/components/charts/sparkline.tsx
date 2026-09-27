"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal SVG sparkline for area-card monthly trends.
 * Pure inline SVG (no chart library) — cheap to render many at once.
 * Values are monthly record counts; the shape communicates momentum,
 * the exact numbers stay in the aria-label for assistive tech.
 */
export function Sparkline({
  values,
  className,
  label,
  width = 120,
  height = 32,
}: {
  values: number[];
  className?: string;
  label: string;
  width?: number;
  height?: number;
}) {
  const n = values.length;
  if (n < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  // Degenerate (flat) series: draw a baseline so the shape still reads as a chart
  const span = max - min;
  const pad = 2;
  const innerH = height - pad * 2;
  const stepX = width / (n - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = span === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} ${width},${height} 0,${height}`;

  const last = values[n - 1];
  const prev = values[n - 2];
  const rising = last > prev;
  const falling = last < prev;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}: ${n}-month trend, latest ${last} per month`}
      className={cn("overflow-visible", className)}
      focusable="false"
    >
      <polygon points={area} className="fill-brand/10" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "transition-all",
          rising ? "stroke-success" : falling ? "stroke-warning" : "stroke-brand"
        )}
      />
      <circle
        cx={points[n - 1][0]}
        cy={points[n - 1][1]}
        r={2.5}
        className={cn(rising ? "fill-success" : falling ? "fill-warning" : "fill-brand")}
      />
    </svg>
  );
}

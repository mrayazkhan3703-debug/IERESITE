/**
 * V2 Data-visualization theme (U02 — V2 Upgrade Prompt §9.2).
 *
 * Single source of truth for recharts brand styling. Values are CSS custom
 * property references (not literal colors) so charts follow the token system
 * in src/app/globals.css and adapt to dark mode / ink sections automatically.
 *
 * Palette: bronze-led warm sequence + warm neutrals + semantic up/down.
 * No blue/indigo — brand red line.
 *
 * Usage:
 *   import { CHART_COLORS, chartColor, CHART_AXIS } from "@/lib/chart-theme";
 *   <Line stroke={CHART_COLORS[0]} />
 *   <Bar fill={chartColor(i)} />
 */

/** Ordered categorical series — bronze first, then warm neutrals. */
export const CHART_COLORS = [
  "var(--ie-viz-1)",
  "var(--ie-viz-2)",
  "var(--ie-viz-3)",
  "var(--ie-viz-4)",
  "var(--ie-viz-5)",
  "var(--ie-viz-6)",
] as const;

/** Series color by index (wraps after 6). */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Semantic colors — direction of change, never categorical. */
export const CHART_SEMANTIC = {
  up: "var(--ie-viz-up)",
  down: "var(--ie-viz-down)",
  neutral: "var(--ie-viz-6)",
  focus: "var(--ie-viz-1)",
} as const;

/** Axis + grid + frame styling shared by every chart. */
export const CHART_AXIS = {
  gridStroke: "var(--ie-viz-grid)",
  axisTickFill: "var(--ie-viz-axis)",
  axisTickFontSize: 11,
  axisTickLine: false,
  axisLine: false,
} as const;

/** Tooltip content style (recharts contentStyle prop). */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  color: "var(--color-foreground)",
  fontSize: "12.5px",
  boxShadow: "var(--ie-elevation-card)",
} as const;

/** Shared recharts cursor (bar hover overlay). */
export const CHART_CURSOR = {
  fill: "var(--ie-viz-5)",
  fillOpacity: 0.35,
} as const;

/** Area/line gradient stops — bronze with editorial fade. */
export const CHART_AREA_GRADIENT = {
  from: "var(--ie-viz-1)",
  fromOpacity: 0.26,
  to: "var(--ie-viz-1)",
  toOpacity: 0.02,
} as const;

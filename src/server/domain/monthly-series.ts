/**
 * Monthly aggregation for market explorer charts.
 * Groups (date, amountMinor) pairs into calendar months, keeping the trailing
 * window. JS-side aggregation is intentional at the current dataset scale —
 * production swaps to SQL date-truncation without changing the response shape.
 */

export interface MonthlyPoint {
  /** Calendar month, "YYYY-MM" */
  month: string;
  count: number;
  /** Average amount in minor units (decimal string over the wire) */
  avgAmountMinor: string | null;
}

export function buildMonthlySeries(
  rows: { date: Date; amountMinor: bigint | null }[],
  monthsWindow = 12
): MonthlyPoint[] {
  const byMonth = new Map<string, { count: number; sum: bigint }>();

  for (const r of rows) {
    if (!r.date || Number.isNaN(r.date.getTime())) continue;
    const y = r.date.getUTCFullYear();
    const m = r.date.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const e = byMonth.get(key) ?? { count: 0, sum: 0n };
    e.count += 1;
    if (r.amountMinor !== null && r.amountMinor !== undefined) e.sum += r.amountMinor;
    byMonth.set(key, e);
  }

  const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  const windowed = sorted.slice(Math.max(0, sorted.length - monthsWindow));

  return windowed.map(([month, e]) => ({
    month,
    count: e.count,
    avgAmountMinor: e.count > 0 && e.sum > 0n ? (e.sum / BigInt(e.count)).toString() : null,
  }));
}

/**
 * Per-area monthly record counts for explorer area-card sparklines.
 * Returns a dense array (zero-filled) over the same trailing window so
 * sparklines are visually comparable across areas.
 */
export function buildAreaTrends(
  rows: { date: Date; areaName: string }[],
  monthsWindow = 12
): { areaName: string; trend: number[] }[] {
  const byArea = new Map<string, Map<string, number>>();
  const monthKeys = new Set<string>();

  for (const r of rows) {
    if (!r.date || Number.isNaN(r.date.getTime()) || !r.areaName) continue;
    const y = r.date.getUTCFullYear();
    const m = r.date.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    monthKeys.add(key);
    const months = byArea.get(r.areaName) ?? new Map<string, number>();
    months.set(key, (months.get(key) ?? 0) + 1);
    byArea.set(r.areaName, months);
  }

  // Dense trailing window across ALL areas (global months, not per-area)
  const sortedMonths = Array.from(monthKeys).sort((a, b) => a.localeCompare(b)).slice(-monthsWindow);

  return Array.from(byArea.entries()).map(([areaName, months]) => ({
    areaName,
    trend: sortedMonths.map((k) => months.get(k) ?? 0),
  }));
}

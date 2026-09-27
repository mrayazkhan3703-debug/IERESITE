/**
 * Precision formatting rules (V2 §21.2).
 *
 * Fixes the over-aggressive abbreviation class of bugs (AED 1.6M displayed as AED 2M).
 * The abbreviating path keeps ≥3 significant figures of the millions value; thousands
 * are always shown as full integers with group separators; full precise values are
 * always available for tooltips/expandable details via fullValueTooltip().
 *
 * Deterministic: hand-rolled formatting, explicit "en-US" grouping, no Intl locale drift.
 */

const groupThousands = (n: number): string => Math.round(Math.abs(n)).toLocaleString("en-US");

/**
 * AED money with meaningful precision:
 *  - ≥ 1,000,000 → millions with (at least) 3 significant figures, shown as
 *    "AED 1.60M", "AED 28.50M", "AED 1.85M" — never collapses to "AED 2M"
 *  - < 1,000,000 → full integer with thousands separators: "AED 126,730"
 */
export function formatAEDPrecise(value: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}AED ${millions.toFixed(2)}M`;
  }
  return `${sign}AED ${groupThousands(abs)}`;
}

/** Monthly variant: "AED 126,730/month". */
export function formatAEDPreciseMonthly(value: number): string {
  return `${formatAEDPrecise(value)}/month`;
}

/** Percentage with fixed digits (default 2), trailing zeros preserved: 6.5 → "6.50%". */
export function formatPctPrecise(value: number, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Full-precision tooltip string (for `title` attributes): "AED 1,604,375". */
export function fullValueTooltip(value: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}AED ${groupThousands(value)}`;
}

/** Full-precision monthly tooltip string: "AED 8,893.32/month" (cents preserved). */
export function fullValueTooltipMonthly(value: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}AED ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month`;
}

/**
 * Money utilities — integer minor units everywhere (ADR-009).
 * JSON APIs transport minor units as decimal strings (Stripe-style).
 */

export function toMinor(units: number | string, currencyDecimals = 2): bigint {
  const n = typeof units === "string" ? Number(units) : units;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${units}`);
  return BigInt(Math.round(n * 10 ** currencyDecimals));
}

export function fromMinor(minor: bigint | string | number, currencyDecimals = 2): number {
  // ADR-009: minor units are integers. Defensive against float products
  // (e.g. 106799588.99999999 from interest arithmetic) and decimal strings —
  // round to the nearest minor unit instead of letting BigInt() throw.
  let b: bigint;
  if (typeof minor === "bigint") b = minor;
  else {
    const n = Number(minor);
    if (!Number.isFinite(n)) return 0;
    b = BigInt(Math.round(n));
  }
  const div = 10n ** BigInt(currencyDecimals);
  return Number(b / div) + Number(b % div) / Number(div);
}

export function formatMoney(
  minor: bigint | string | number | null | undefined,
  opts?: { currency?: string; compact?: boolean; locale?: string; decimals?: number }
): string {
  if (minor === null || minor === undefined) return "—";
  const currency = opts?.currency ?? "AED";
  const locale = opts?.locale ?? "en-AE";
  const value = fromMinor(minor, opts?.decimals ?? 2);
  try {
    // Precision rules (V2 §21.2): never over-abbreviate. The old compact path rounded
    // AED 1.6M up to "AED 2M" (0 fraction digits); compact now keeps 3 significant
    // figures of the millions value (2 decimals < 10M, 1 decimal ≥ 10M) and one
    // decimal in the thousands range, so 1,604,375 → "AED 1.60M", not "AED 2M".
    const compact = opts?.compact ?? false;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      ...(compact && Math.abs(value) >= 1_000_000
        ? { minimumFractionDigits: Math.abs(value) >= 10_000_000 ? 1 : 2, maximumFractionDigits: Math.abs(value) >= 10_000_000 ? 1 : 2 }
        : compact
          ? { minimumFractionDigits: 0, maximumFractionDigits: 1 }
          : { maximumFractionDigits: value >= 10000 ? 0 : opts?.decimals ?? 0 }),
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

export function formatNumber(n: number | null | undefined, locale = "en-AE", opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale, opts).format(n);
}

export function formatPercent(n: number | null | undefined, locale = "en-AE", digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(n / 100);
}

export function formatDate(d: string | Date | null | undefined, locale = "en-AE", opts?: Intl.DateTimeFormatOptions): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
    timeZone: opts?.timeZone ?? "Asia/Dubai",
  }).format(date);
}

/** Price-per-sqft from minor units */
export function pricePerSqftMinor(priceMinor: bigint, areaSqft: number): bigint | null {
  if (!areaSqft || areaSqft <= 0) return null;
  return (priceMinor * 100n) / BigInt(Math.round(areaSqft * 100));
}

export const CURRENCY_SYMBOL: Record<string, string> = { AED: "AED", USD: "$", EUR: "€", GBP: "£", SAR: "SAR" };

/** Approximate FX table for the currency tool (clearly labeled indicative rates, refreshed manually) */
export const INDICATIVE_FX: Record<string, number> = {
  AED: 1, USD: 3.6725, EUR: 4.02, GBP: 4.68, SAR: 0.979, INR: 0.044, CNY: 0.51, RUB: 0.039,
};

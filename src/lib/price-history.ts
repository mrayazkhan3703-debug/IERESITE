/**
 * Price-history hygiene helpers (V2 §14.7 — price history data side).
 *
 * Listing price histories must be deduplicated (same date + same price is one
 * event, not two) and ordered before change columns are computed, so the
 * property detail view never renders duplicate timestamps or misleading
 * deltas. Prepared for U06 (property detail V2) — deliberately NOT wired into
 * any view yet.
 */

/** Loose input accepted from Prisma rows or API payloads. */
export interface PriceHistoryEntryInput {
  /** Recording date of the price point. */
  date: Date | string | number;
  /** Price in minor units (BigInt | serialized string | number). */
  priceMinor: bigint | string | number;
  /** Provenance of the point, e.g. "INTERNAL" | "DEMO_SEED" | "VERIFIED". */
  sourceType?: string | null;
  /** Optional free-form note (e.g. "price qualified after re-listing"). */
  note?: string | null;
}

/** Cleaned, deduplicated, ordered history point with derived change columns. */
export interface PriceHistoryEntry {
  /** ISO-8601 date (UTC, start of day). */
  date: string;
  /** Price in minor units, serialized as a decimal string (ADR-009). */
  priceMinor: string;
  /** Absolute change vs the previous retained point (minor units), null on the first. */
  absChangeMinor: string | null;
  /** Percentage change vs the previous retained point, rounded to 2 dp, null on the first. */
  pctChange: number | null;
  /** Provenance of the point. */
  sourceType: string | null;
  note: string | null;
}

function toTime(date: Date | string | number): number | null {
  const t = date instanceof Date ? date.getTime() : typeof date === "number" ? date : Date.parse(date);
  return Number.isNaN(t) ? null : t;
}

function toBig(price: bigint | string | number): bigint | null {
  try {
    return typeof price === "bigint" ? price : BigInt(price);
  } catch {
    return null;
  }
}

/**
 * Deduplicate by (date + price), drop unparseable points, sort ascending by
 * date, then compute absChange/pctChange between consecutive retained points.
 *
 * Dedupe keeps the FIRST occurrence (in input order) of a (date, price) pair —
 * later duplicates are assumed re-emissions of the same event. Malformed
 * entries (unparseable date or price) are dropped rather than crashing the
 * caller; callers that need drop counts can compare input/output lengths.
 */
export function dedupePriceHistory(entries: readonly PriceHistoryEntryInput[]): PriceHistoryEntry[] {
  const seen = new Set<string>();
  const kept: { t: number; day: string; priceMinor: bigint; sourceType: string | null; note: string | null }[] = [];

  for (const e of entries ?? []) {
    const t = toTime(e.date);
    const price = toBig(e.priceMinor);
    // Malformed points are excluded from presentation entirely (§14.7 duplicate
    // handling — never render a row we cannot interpret).
    if (t === null || price === null) continue;

    const day = new Date(t);
    const dayKey = day.toISOString().slice(0, 10); // UTC calendar day
    const key = `${dayKey}:${price.toString()}`;
    if (seen.has(key)) continue; // same date + same price → duplicate event
    seen.add(key);

    kept.push({
      t,
      day: dayKey,
      priceMinor: price,
      sourceType: e.sourceType ?? null,
      note: e.note ?? null,
    });
  }

  kept.sort((a, b) => a.t - b.t);

  return kept.map((k, i) => {
    const prev = i > 0 ? kept[i - 1] : null;
    let absChangeMinor: string | null = null;
    let pctChange: number | null = null;
    if (prev && prev.priceMinor !== 0n) {
      const abs = k.priceMinor - prev.priceMinor;
      absChangeMinor = abs.toString();
      pctChange =
        Math.round(
          (Number(abs) / Number(prev.priceMinor)) * 100 * 100
        ) / 100;
    } else if (prev && prev.priceMinor === 0n) {
      // A zero previous price makes percentage change meaningless — report the
      // absolute change only (honest derived metrics, §19.5).
      absChangeMinor = (k.priceMinor - prev.priceMinor).toString();
    }
    return {
      date: k.day,
      priceMinor: k.priceMinor.toString(),
      absChangeMinor,
      pctChange,
      sourceType: k.sourceType,
      note: k.note,
    };
  });
}

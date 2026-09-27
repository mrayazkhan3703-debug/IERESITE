import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { buildMonthlySeries, buildAreaTrends } from "@/server/domain/monthly-series";
import { validateTransactionRecords } from "@/server/domain/read-models";
import { getDataState, resolveMetricState } from "@/lib/data-state";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  community: z.string().max(120).optional(),
  propertyType: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
  /* U10 (§19.3) additive: registration type (SALE|MORTGAGE|GIFT). */
  transactionType: z.enum(["SALE", "MORTGAGE", "GIFT"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const q = querySchema.parse(raw);

  const where = {
    ...(q.community ? { OR: [{ areaName: { contains: q.community } }, { community: { slug: q.community } }] } : {}),
    ...(q.propertyType ? { propertyType: q.propertyType } : {}),
    ...(q.transactionType ? { transactionType: q.transactionType } : {}),
    ...(q.from || q.to
      ? {
          transactionDate: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        }
      : {}),
    ...(q.minAmount ? { amountMinor: { gte: BigInt(q.minAmount) } } : {}),
    ...(q.maxAmount ? { amountMinor: { lte: BigInt(q.maxAmount) } } : {}),
  };

  // Single filtered fetch: validation, aggregation and pagination all operate on
  // the SAME rows so counts can never disagree (V2 §19.5/§38 — malformed rows
  // must never silently feed charts). JS-side at current scale; production swaps
  // to SQL.
  const allRows = await db.marketTransaction.findMany({
    where,
    orderBy: { transactionDate: "desc" },
    take: 10000,
  });

  const { validRows, validation } = validateTransactionRecords(allRows);

  // HARD-invalid rows (non-positive amount) are excluded from the listing, area
  // cards and charts; SOFT-invalid rows (missing size) stay in price-level
  // statistics but are excluded from AED/sqft derived metrics.
  const pageRows = validRows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const total = validRows.length;

  const byArea = new Map<string, { count: number; sum: bigint }>();
  for (const r of validRows) {
    const e = byArea.get(r.areaName) ?? { count: 0, sum: 0n };
    e.count += 1;
    e.sum += r.amountMinor;
    byArea.set(r.areaName, e);
  }
  const byCommunity = Array.from(byArea.entries())
    .map(([areaName, e]) => ({
      areaName,
      count: e.count,
      avgAmountMinor: e.count > 0 ? BigInt(Math.round(Number(e.sum) / e.count)).toString() : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const areaTrends = new Map(
    buildAreaTrends(validRows.map((r) => ({ date: r.transactionDate, areaName: r.areaName }))).map((t) => [t.areaName, t.trend])
  );

  const seriesInput = validRows.map((r) => ({ date: r.transactionDate, amountMinor: r.amountMinor }));

  /* ------------------------------------------------------------------ *
   * U10 (§19.4) additive aggregation block — computed over the SAME
   * validRows so every explorer surface (chips, charts, tables, export)
   * shares one source of truth. Existing fields are untouched.
   * ------------------------------------------------------------------ */
  const medianOf = (nums: number[]): number | null => {
    if (nums.length === 0) return null;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const toMinorString = (aed: number | null): string | null =>
    aed === null ? null : BigInt(Math.round(aed * 100)).toString();

  const amountsAed = validRows.map((r) => Number(r.amountMinor) / 100);
  const ppsftAed = validRows
    .filter((r) => r.pricePerSqftMinor !== null && r.pricePerSqftMinor !== undefined)
    .map((r) => Number(r.pricePerSqftMinor) / 100);

  // Monthly median merge (volume chart median/average toggle §19.4)
  const monthlyAmounts = new Map<string, number[]>();
  for (const r of validRows) {
    const key = r.transactionDate.toISOString().slice(0, 7);
    const arr = monthlyAmounts.get(key) ?? [];
    arr.push(Number(r.amountMinor) / 100);
    monthlyAmounts.set(key, arr);
  }
  const series = buildMonthlySeries(seriesInput).map((p) => {
    const med = medianOf(monthlyAmounts.get(p.month) ?? []);
    return { ...p, medianAmountMinor: toMinorString(med) };
  });

  // Distribution histogram: 8 equal buckets over the observed range (§19.4)
  const distBuckets: { label: string; fromMinor: string; toMinor: string | null; count: number }[] = [];
  const minAmt = amountsAed.length ? Math.min(...amountsAed) : 0;
  const maxAmt = amountsAed.length ? Math.max(...amountsAed) : 0;
  if (amountsAed.length > 0 && maxAmt > minAmt) {
    const BUCKETS = 8;
    const width = (maxAmt - minAmt) / BUCKETS;
    const counts = new Array(BUCKETS).fill(0);
    for (const a of amountsAed) {
      const idx = Math.min(BUCKETS - 1, Math.floor((a - minAmt) / width));
      counts[idx] += 1;
    }
    for (let i = 0; i < BUCKETS; i++) {
      const from = minAmt + i * width;
      const to = i === BUCKETS - 1 ? maxAmt : minAmt + (i + 1) * width;
      distBuckets.push({
        label: `${Math.round(from / 1000)}k–${Math.round(to / 1000)}k`,
        fromMinor: toMinorString(from)!,
        toMinor: toMinorString(to)!,
        count: counts[i],
      });
    }
  }

  // Property-type mix (§19.4)
  const typeAgg = new Map<string, number[]>();
  for (const r of validRows) {
    const arr = typeAgg.get(r.propertyType) ?? [];
    arr.push(Number(r.amountMinor) / 100);
    typeAgg.set(r.propertyType, arr);
  }
  const byPropertyType = Array.from(typeAgg.entries())
    .map(([type, nums]) => ({
      type,
      count: nums.length,
      medianAmountMinor: toMinorString(medianOf(nums)),
    }))
    .sort((a, b) => b.count - a.count);

  // Full per-area aggregation (community comparison table §19.4) — all areas
  const areaFull = new Map<string, { count: number; amounts: number[]; ppsft: number[] }>();
  for (const r of validRows) {
    const e = areaFull.get(r.areaName) ?? { count: 0, amounts: [], ppsft: [] };
    e.count += 1;
    e.amounts.push(Number(r.amountMinor) / 100);
    if (r.pricePerSqftMinor !== null && r.pricePerSqftMinor !== undefined) e.ppsft.push(Number(r.pricePerSqftMinor) / 100);
    areaFull.set(r.areaName, e);
  }
  const byAreaFull = Array.from(areaFull.entries())
    .map(([areaName, e]) => ({
      areaName,
      count: e.count,
      medianAmountMinor: toMinorString(medianOf(e.amounts)),
      avgAmountMinor: toMinorString(e.amounts.reduce((s, n) => s + n, 0) / e.amounts.length),
      medianPerSqftMinor: toMinorString(medianOf(e.ppsft)),
    }))
    .sort((a, b) => b.count - a.count);

  // Per-area monthly medians (compare-areas trend lines §19.5/§19.6)
  const areaMonthly = new Map<string, Map<string, number[]>>();
  for (const r of validRows) {
    const month = areaMonthly.get(r.areaName) ?? new Map<string, number[]>();
    const key = r.transactionDate.toISOString().slice(0, 7);
    const arr = month.get(key) ?? [];
    arr.push(Number(r.amountMinor) / 100);
    month.set(key, arr);
    areaMonthly.set(r.areaName, month);
  }
  const areaSeries = Array.from(areaMonthly.entries()).map(([areaName, monthMap]) => ({
    areaName,
    monthly: Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, nums]) => ({ month, count: nums.length, medianAmountMinor: toMinorString(medianOf(nums)) })),
  }));

  const dates = validRows.map((r) => r.transactionDate.getTime());
  const totalVolumeMinor = validRows.reduce((s, r) => s + r.amountMinor, 0n);

  const agg = {
    count: validRows.length,
    totalVolumeMinor: totalVolumeMinor.toString(),
    medianAmountMinor: toMinorString(medianOf(amountsAed)),
    avgAmountMinor: toMinorString(amountsAed.length ? amountsAed.reduce((s, n) => s + n, 0) / amountsAed.length : null),
    medianPerSqftMinor: toMinorString(medianOf(ppsftAed)),
    perSqftCount: ppsftAed.length,
    excludedRecords: validation.excludedRecords,
    dateMin: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    dateMax: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    distribution: distBuckets,
    byPropertyType,
    byAreaFull,
    areaSeries,
    // Distinct filter option sets (§19.3) — from the filtered-but-unpaged rows
    filterOptions: {
      areas: byAreaFull.map((a) => ({ areaName: a.areaName, count: a.count })),
      propertyTypes: byPropertyType.map((t) => ({ type: t.type, count: t.count })),
    },
  };

  return NextResponse.json({
    // Data-quality transparency (V2 §19.5): excluded rows are reported, never
    // hidden — surfaced first so consumers always see the validation contract.
    validation,
    dataState: getDataState(),
    total,
    page: q.page,
    pageSize: q.pageSize,
    rows: pageRows.map((r) => ({
      id: r.id,
      transactionDate: r.transactionDate.toISOString(),
      areaName: r.areaName,
      propertyType: r.propertyType,
      transactionType: r.transactionType,
      amountMinor: r.amountMinor.toString(),
      currency: r.currency,
      sizeSqft: r.sizeSqft,
      pricePerSqftMinor: r.pricePerSqftMinor?.toString() ?? null,
      projectName: r.projectName,
      isIllustrative: r.isIllustrative,
      source: r.source,
      // Per-row presentation state from the data-state machine (V2 §37).
      state: resolveMetricState({
        sourcePublisher: r.source,
        sourceType: r.source,
        isIllustrative: r.isIllustrative,
      }),
    })),
    byCommunity: byCommunity.map((c) => ({
      ...c,
      trend: areaTrends.get(c.areaName) ?? [],
    })),
    series,
    // U10 (§19.4) additive aggregation block — same validated rows.
    agg,
  });
});

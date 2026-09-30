import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { buildMonthlySeries, buildAreaTrends } from "@/server/domain/monthly-series";
import { validateRentRecords } from "@/server/domain/read-models";
import { getDataState, resolveMetricState } from "@/lib/data-state";
import { marketProvenance } from "@/server/ingestion/market-provenance";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  community: z.string().max(120).optional(),
  bedrooms: z.coerce.number().int().min(0).max(10).optional(),
  /* U10 (§19.3) additive filters: property type + date range. */
  propertyType: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
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
    ...(q.bedrooms !== undefined ? { bedrooms: q.bedrooms } : {}),
    ...(q.propertyType ? { propertyType: q.propertyType } : {}),
    ...(q.from || q.to
      ? {
          contractDate: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        }
      : {}),
  };

  // Single filtered fetch: validation, aggregation and pagination all operate on
  // the SAME rows so counts can never disagree (V2 §19.5 — fix data quality
  // before presentation). JS-side at current scale; production swaps to SQL.
  const allRows = await db.marketRent.findMany({
    where,
    include: { importRun: { include: { importSource: { select: { url: true, configJson: true } } } } },
    orderBy: { contractDate: "desc" },
    take: 10000,
  });

  const { validRows, validation } = validateRentRecords(allRows);

  // HARD-invalid rows (zero-bed non-studio, non-positive rent) are excluded from
  // the listing, area cards and charts; SOFT-invalid rows (missing size) stay in
  // rent-level statistics but are excluded from rent/sqft derived metrics.
  const pageRows = validRows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const total = validRows.length;

  const byArea = new Map<string, { count: number; sum: bigint }>();
  for (const r of validRows) {
    const e = byArea.get(r.areaName) ?? { count: 0, sum: 0n };
    e.count += 1;
    e.sum += r.annualRentMinor;
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
    buildAreaTrends(validRows.map((r) => ({ date: r.contractDate, areaName: r.areaName }))).map((t) => [t.areaName, t.trend])
  );

  const seriesInput = validRows.map((r) => ({ date: r.contractDate, amountMinor: r.annualRentMinor }));

  /* ------------------------------------------------------------------ *
   * U10 (§19.5) additive aggregation block — computed over the SAME
   * validRows so chips/charts/tables/export all share one source.
   * ------------------------------------------------------------------ */
  const medianOf = (nums: number[]): number | null => {
    if (nums.length === 0) return null;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const toMinorString = (aed: number | null): string | null =>
    aed === null ? null : BigInt(Math.round(aed * 100)).toString();

  const rentsAed = validRows.map((r) => Number(r.annualRentMinor) / 100);

  // Monthly median merge (volume chart median/average toggle §19.5)
  const monthlyAmounts = new Map<string, number[]>();
  for (const r of validRows) {
    const key = r.contractDate.toISOString().slice(0, 7);
    const arr = monthlyAmounts.get(key) ?? [];
    arr.push(Number(r.annualRentMinor) / 100);
    monthlyAmounts.set(key, arr);
  }
  const series = buildMonthlySeries(seriesInput).map((p) => {
    const med = medianOf(monthlyAmounts.get(p.month) ?? []);
    return { ...p, medianAmountMinor: toMinorString(med) };
  });

  // Distribution histogram: 8 equal buckets over the observed rent range (§19.5)
  const distBuckets: { label: string; fromMinor: string; toMinor: string | null; count: number }[] = [];
  const minRent = rentsAed.length ? Math.min(...rentsAed) : 0;
  const maxRent = rentsAed.length ? Math.max(...rentsAed) : 0;
  if (rentsAed.length > 0 && maxRent > minRent) {
    const BUCKETS = 8;
    const width = (maxRent - minRent) / BUCKETS;
    const counts = new Array(BUCKETS).fill(0);
    for (const a of rentsAed) {
      const idx = Math.min(BUCKETS - 1, Math.floor((a - minRent) / width));
      counts[idx] += 1;
    }
    for (let i = 0; i < BUCKETS; i++) {
      const from = minRent + i * width;
      const to = i === BUCKETS - 1 ? maxRent : minRent + (i + 1) * width;
      distBuckets.push({
        label: `${Math.round(from / 1000)}k–${Math.round(to / 1000)}k`,
        fromMinor: toMinorString(from)!,
        toMinor: toMinorString(to),
        count: counts[i],
      });
    }
  }

  // Property-type mix + bedroom mix (§19.5)
  const typeAgg = new Map<string, number[]>();
  const bedAgg = new Map<number, number[]>();
  for (const r of validRows) {
    const tArr = typeAgg.get(r.propertyType) ?? [];
    tArr.push(Number(r.annualRentMinor) / 100);
    typeAgg.set(r.propertyType, tArr);
    if (r.bedrooms !== null && r.bedrooms !== undefined) {
      const bKey = Math.round(r.bedrooms);
      const bArr = bedAgg.get(bKey) ?? [];
      bArr.push(Number(r.annualRentMinor) / 100);
      bedAgg.set(bKey, bArr);
    }
  }
  const byPropertyType = Array.from(typeAgg.entries())
    .map(([type, nums]) => ({ type, count: nums.length, medianAmountMinor: toMinorString(medianOf(nums)) }))
    .sort((a, b) => b.count - a.count);
  const byBedrooms = Array.from(bedAgg.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bedrooms, nums]) => ({
      bedrooms,
      count: nums.length,
      medianRentMinor: toMinorString(medianOf(nums)),
    }));

  // Full per-area aggregation (compare-areas §19.5)
  const areaFull = new Map<string, { count: number; rents: number[] }>();
  for (const r of validRows) {
    const e = areaFull.get(r.areaName) ?? { count: 0, rents: [] };
    e.count += 1;
    e.rents.push(Number(r.annualRentMinor) / 100);
    areaFull.set(r.areaName, e);
  }
  const byAreaFull = Array.from(areaFull.entries())
    .map(([areaName, e]) => ({
      areaName,
      count: e.count,
      medianRentMinor: toMinorString(medianOf(e.rents)),
      avgRentMinor: toMinorString(e.rents.reduce((s, n) => s + n, 0) / e.rents.length),
    }))
    .sort((a, b) => b.count - a.count);

  // Per-area monthly medians (compare-areas trend lines §19.5)
  const areaMonthly = new Map<string, Map<string, number[]>>();
  for (const r of validRows) {
    const month = areaMonthly.get(r.areaName) ?? new Map<string, number[]>();
    const key = r.contractDate.toISOString().slice(0, 7);
    const arr = month.get(key) ?? [];
    arr.push(Number(r.annualRentMinor) / 100);
    month.set(key, arr);
    areaMonthly.set(r.areaName, month);
  }
  const areaSeries = Array.from(areaMonthly.entries()).map(([areaName, monthMap]) => ({
    areaName,
    monthly: Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, nums]) => ({ month, count: nums.length, medianAmountMinor: toMinorString(medianOf(nums)) })),
  }));

  const dates = validRows.map((r) => r.contractDate.getTime());

  const agg = {
    count: validRows.length,
    illustrativeCount: validRows.filter((r) => r.isIllustrative).length,
    sourcedCount: validRows.filter((r) => !r.isIllustrative).length,
    medianRentMinor: toMinorString(medianOf(rentsAed)),
    avgRentMinor: toMinorString(rentsAed.length ? rentsAed.reduce((s, n) => s + n, 0) / rentsAed.length : null),
    excludedRecords: validation.excludedRecords,
    dateMin: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    dateMax: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    distribution: distBuckets,
    byPropertyType,
    byBedrooms,
    byAreaFull,
    areaSeries,
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
      contractDate: r.contractDate.toISOString(),
      areaName: r.areaName,
      propertyType: r.propertyType,
      bedrooms: r.bedrooms,
      annualRentMinor: r.annualRentMinor.toString(),
      currency: r.currency,
      sizeSqft: r.sizeSqft,
      isIllustrative: r.isIllustrative,
      source: r.source,
      provenance: marketProvenance(r.importRun),
      // Per-row presentation state from the data-state machine (V2 §37).
      state: resolveMetricState({
        sourcePublisher: r.source,
        sourceType: r.source,
        retrievedAt: r.importRun?.snapshotRetrievedAt,
        isIllustrative: r.isIllustrative,
      }),
    })),
    // Mirrors /api/market/transactions contract so the shared explorer view
    // can render both variants from one typed response shape.
    byCommunity: byCommunity.map((c) => ({
      ...c,
      trend: areaTrends.get(c.areaName) ?? [],
    })),
    series,
    // U10 (§19.5) additive aggregation block — same validated rows.
    agg,
  });
});

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { marketSourceConfig, marketFreshness } from "@/lib/market-import";
import { audit, HttpError, type SessionUser } from "@/server/auth";

export const GENERATED_MARKET_SOURCE = "IERESITE recorded-data aggregation";
export async function rebuildMarketMetrics(actor: SessionUser, ip: string | null) {
  if (!actor.roles.some((r) => ["OWNER", "ADMIN"].includes(r))) throw new HttpError(403, "Owner or Admin access is required.");
  return db.$transaction(async (tx) => {
    const [transactions, rents] = await Promise.all([
      tx.marketTransaction.findMany({ where: { communityId: { not: null }, amountMinor: { gt: 0 } }, take: 10001, include: { importRun: { include: { importSource: true } } } }),
      tx.marketRent.findMany({ where: { communityId: { not: null }, annualRentMinor: { gt: 0 } }, take: 10001, include: { importRun: { include: { importSource: true } } } }),
    ]);
    if (transactions.length > 10000 || rents.length > 10000) throw new HttpError(409, "Dataset exceeds the interactive rebuild limit. A worker-backed rebuild is required.");
    type Observation = (typeof transactions)[number] | (typeof rents)[number];
    const groups = new Map<string, { communityId: string; periodStart: Date; values: Map<string, number[]>; illustrative: boolean; sourceUrls: Set<string>; retrievedAt: Date }>();
    function add(row: Observation) {
      const source = marketSourceConfig(row.importRun?.importSource.configJson ?? null);
      if (row.importRun && (!row.importRun.appliedAt || !source || marketFreshness(row.importRun.snapshotRetrievedAt, source.staleAfterDays) !== "CURRENT")) return;
      const date = "transactionDate" in row ? row.transactionDate : row.contractDate;
      const periodStart = new Date(`${date.toISOString().slice(0, 7)}-01`);
      // A separate observation group prevents illustrative inputs from
      // contaminating actual-source statistics at the same community/month.
      const key = `${row.communityId}:${periodStart.toISOString()}:${row.isIllustrative}`;
      let group = groups.get(key);
      if (!group) {
        group = { communityId: row.communityId!, periodStart, values: new Map(), illustrative: row.isIllustrative, sourceUrls: new Set(), retrievedAt: row.importRun?.snapshotRetrievedAt ?? row.createdAt };
        groups.set(key, group);
      }
      if (source?.url) group.sourceUrls.add(source.url);
      const retrievedAt = row.importRun?.snapshotRetrievedAt ?? row.createdAt;
      if (retrievedAt > group.retrievedAt) group.retrievedAt = retrievedAt;
      const push = (metric: string, value: number) => group!.values.set(metric, [...(group!.values.get(metric) ?? []), value]);
      if ("amountMinor" in row && row.transactionType === "SALE") {
        push("TRANSACTION_COUNT", 1); push("MEDIAN_TRANS_PRICE", Number(row.amountMinor) / 100);
        if (row.sizeSqft && row.sizeSqft > 0) push("AVG_PRICE_PER_SQFT", Number(row.amountMinor) / 100 / row.sizeSqft);
      } else if ("annualRentMinor" in row && row.bedrooms === 1) push("AVG_RENT_1BR", Number(row.annualRentMinor) / 100);
    }
    [...transactions, ...rents].forEach(add);
    await tx.marketMetric.deleteMany({ where: { sourceName: GENERATED_MARKET_SOURCE } });
    let count = 0, preserved = 0;
    // Actual-source metrics take precedence; each output still carries its
    // source retrieval time and is explicitly a computed, modeled statistic.
    for (const group of [...groups.values()].sort((a, b) => Number(a.illustrative) - Number(b.illustrative))) for (const [metricKey, values] of group.values) {
      values.sort((a, b) => a - b);
      const valueNumeric = metricKey === "TRANSACTION_COUNT" ? values.length : metricKey === "MEDIAN_TRANS_PRICE" ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : values.reduce((a, b) => a + b, 0) / values.length;
      const periodEnd = new Date(Date.UTC(group.periodStart.getUTCFullYear(), group.periodStart.getUTCMonth() + 1, 0));
      const existing = await tx.marketMetric.findUnique({ where: { communityId_metricKey_periodStart: { communityId: group.communityId, metricKey, periodStart: group.periodStart } } });
      if (existing) { preserved++; continue; }
      await tx.marketMetric.create({ data: {
        communityId: group.communityId, metricKey, periodStart: group.periodStart, periodEnd, valueNumeric,
        unit: metricKey === "TRANSACTION_COUNT" ? "COUNT" : metricKey === "AVG_PRICE_PER_SQFT" ? "AED_PER_SQFT" : "AED",
        sourceName: GENERATED_MARKET_SOURCE, sourceUrl: [...group.sourceUrls][0] ?? null,
        methodology: `${group.illustrative ? "ILLUSTRATIVE" : "MODELED"}: ${metricKey} from ${values.length} recorded observations. Missing sizes excluded; sale-only transactions. Sources: ${[...group.sourceUrls].join(", ") || "legacy source labels"}.`,
        retrievedAt: group.retrievedAt, isIllustrative: group.illustrative,
      } });
      count++;
    }
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "market.metrics.rebuild", resourceType: "market_metrics", resourceId: "recorded-data", before: null, after: { count, preserved, transactions: transactions.length, rents: rents.length }, ip }, tx);
    return { count, preserved };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 });
}

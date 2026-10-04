import { Prisma } from "@prisma/client";

/** Aggregate in PostgreSQL; daily diagnostics must not truncate or load every request. */
export async function aiDailyUsageTotals(client: Pick<Prisma.TransactionClient, "$queryRaw">, dayStart: Date, unknownReserve: number) {
  const rows = await client.$queryRaw<{ requests: bigint; tokens: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS requests,
      COALESCE(SUM(CASE WHEN "reservedTokens" > 0 THEN "reservedTokens"
        WHEN "promptTokens" IS NULL OR "completionTokens" IS NULL THEN ${unknownReserve}
        ELSE "promptTokens"::bigint + "completionTokens"::bigint END), 0)::bigint AS tokens
    FROM "AiUsage" WHERE "createdAt" >= ${dayStart}
  `);
  const requestsToday = Number(rows[0]?.requests ?? 0), reservedTokensToday = Number(rows[0]?.tokens ?? 0);
  if (![requestsToday, reservedTokensToday].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid AI usage aggregate");
  return { requestsToday, reservedTokensToday };
}

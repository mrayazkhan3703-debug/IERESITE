import { afterAll, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { aiReservationTransactionOptions } from "@/server/ai/reservation-budget";

const localHosts = ["localhost", "127.0.0.1", "postgres", "host.docker.internal"];
if (!localHosts.includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Reservation timing verification requires a disposable local database.");
const id = "reservation-delay-" + crypto.randomUUID();
afterAll(async () => { await db.aiUsage.deleteMany({ where: { id } }); await db.$disconnect(); });

test("atomic reservation commits after remote-equivalent round-trip delay beyond five seconds", async () => {
  const result = await db.$transaction(async tx => {
    await tx.aiUsage.create({ data: { id, provider: "mock", model: "local-reservation-timing", kind: "CHAT", status: "RESERVED", reservedTokens: 100 } });
    await tx.$queryRaw`SELECT pg_sleep(5.25)::text`;
    return tx.aiUsage.findUniqueOrThrow({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...aiReservationTransactionOptions(Date.now() + 60000) });
  expect(result.status).toBe("RESERVED");
  expect((await db.aiUsage.findUniqueOrThrow({ where: { id } })).reservedTokens).toBe(100);
}, 20000);

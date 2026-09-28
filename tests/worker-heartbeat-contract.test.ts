import { describe, expect, test } from "bun:test";
import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_MAX_AGE_MS } from "@/server/jobs/worker-health";

describe("dedicated worker heartbeat contract", () => {
  test("allows multiple missed writes before reporting stale", () => {
    expect(WORKER_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
    expect(WORKER_HEARTBEAT_MAX_AGE_MS).toBeGreaterThanOrEqual(WORKER_HEARTBEAT_INTERVAL_MS * 3);
  });

  test("schema migration creates a queryable heartbeat record", async () => {
    const migration = await Bun.file("prisma/migrations/20260928000100_worker_heartbeat/migration.sql").text();
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "WorkerHeartbeat"');
    expect(migration).toContain('"serviceName" TEXT NOT NULL');
    expect(migration).toContain('"heartbeatAt" TIMESTAMPTZ(3) NOT NULL');
    expect(migration).toContain('ALTER TABLE "WorkerHeartbeat" ENABLE ROW LEVEL SECURITY');
  });
});

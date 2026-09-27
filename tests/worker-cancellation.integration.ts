import { afterAll, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { releaseJobAfterShutdown } from "@/server/jobs/lease";
import { jobQueueMetrics } from "@/server/jobs/outbox";

const jobIdempotencyKey = `worker-shutdown-release-${crypto.randomUUID()}`;

afterAll(async () => {
  await db.jobRun.deleteMany({ where: { idempotencyKey: jobIdempotencyKey } });
  await db.$disconnect();
});

test("shutdown releases only the current worker lease and restores the claimed attempt", async () => {
  const workerId = `shutdown-test-${crypto.randomUUID()}`;
  const now = new Date();
  const job = await db.jobRun.create({
    data: {
      jobKey: "search.reindex.all",
      payloadJson: {},
      idempotencyKey: jobIdempotencyKey,
      status: "RUNNING",
      attempts: 1,
      maxAttempts: 3,
      lockedBy: workerId,
      lockedAt: now,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    },
  });

  const metrics = await jobQueueMetrics();
  expect(Number.isInteger(metrics.running)).toBe(true);
  expect(metrics.running).toBeGreaterThanOrEqual(1);
  expect(metrics.oldestDueAgeSec === null || metrics.oldestDueAgeSec >= 0).toBe(true);
  const releasedCount = await releaseJobAfterShutdown(db, job.id, workerId);
  const released = await db.jobRun.findUniqueOrThrow({ where: { id: job.id } });
  expect(releasedCount).toBe(1);
  expect(released.status).toBe("RETRYING");
  expect(released.attempts).toBe(0);
  expect(released.lockedBy).toBeNull();
  expect(released.lockedAt).toBeNull();
  expect(released.leaseExpiresAt).toBeNull();
});

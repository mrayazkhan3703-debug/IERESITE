import type { PrismaClient } from "@prisma/client";
/** Deferral preserves scheduled work and does not consume a failure attempt. */
export class JobDeferredError extends Error {
  constructor(readonly code = "CRM_SYNC_DEFERRED", readonly retryAfterMs = 86400000) {
    super(code); this.name = "JobDeferredError";
  }
}

/** A deferral is pending work, not a failed delivery attempt. */
export async function releaseDeferredJob(client: Pick<PrismaClient, "jobRun">, jobId: string, workerId: string, error: JobDeferredError, now = new Date()): Promise<number> {
  const result = await client.jobRun.updateMany({
    where: { id: jobId, status: "RUNNING", lockedBy: workerId, attempts: { gt: 0 } },
    data: { status: "RETRYING", attempts: { decrement: 1 }, error: error.code,
      scheduledAt: new Date(now.getTime() + error.retryAfterMs),
      lockedBy: null, lockedAt: null, leaseExpiresAt: null },
  });
  return result.count;
}

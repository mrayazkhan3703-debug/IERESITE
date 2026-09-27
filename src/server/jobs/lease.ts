import type { PrismaClient } from "@prisma/client";

/** Release only a lease still owned by this worker; shutdown does not spend an attempt. */
export async function releaseJobAfterShutdown(
  client: Pick<PrismaClient, "jobRun">,
  jobId: string,
  workerId: string,
): Promise<number> {
  const result = await client.jobRun.updateMany({
    where: { id: jobId, status: "RUNNING", lockedBy: workerId },
    data: {
      status: "RETRYING",
      attempts: { decrement: 1 },
      scheduledAt: new Date(),
      error: "Worker shutdown requested; job released without consuming an attempt.",
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    },
  });
  return result.count;
}

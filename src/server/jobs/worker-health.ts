import { db } from "@/lib/db";

export const PRIMARY_WORKER_SERVICE = "iere-staging-worker";
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
export const WORKER_HEARTBEAT_MAX_AGE_MS = 60_000;

function runtimeIdentity() {
  return {
    instanceId: process.env.RENDER_INSTANCE_ID?.trim() || process.env.HOSTNAME?.trim() || null,
    buildRevision: process.env.RENDER_GIT_COMMIT?.trim() || process.env.BUILD_REVISION?.trim() || null,
  };
}

export async function markWorkerStarted(serviceName = PRIMARY_WORKER_SERVICE) {
  const now = new Date();
  const identity = runtimeIdentity();
  return db.workerHeartbeat.upsert({
    where: { serviceName },
    create: {
      serviceName,
      ...identity,
      status: "RUNNING",
      startedAt: now,
      heartbeatAt: now,
      stoppedAt: null,
    },
    update: {
      ...identity,
      status: "RUNNING",
      startedAt: now,
      heartbeatAt: now,
      stoppedAt: null,
    },
  });
}

export async function touchWorkerHeartbeat(serviceName = PRIMARY_WORKER_SERVICE) {
  const now = new Date();
  const identity = runtimeIdentity();
  return db.workerHeartbeat.update({
    where: { serviceName },
    data: { ...identity, status: "RUNNING", heartbeatAt: now, stoppedAt: null },
  });
}

export async function markWorkerStopping(serviceName = PRIMARY_WORKER_SERVICE) {
  const { instanceId } = runtimeIdentity();
  return db.workerHeartbeat.updateMany({
    where: { serviceName, instanceId },
    data: { status: "STOPPING", heartbeatAt: new Date() },
  });
}

export async function markWorkerStopped(serviceName = PRIMARY_WORKER_SERVICE) {
  const now = new Date();
  const { instanceId } = runtimeIdentity();
  return db.workerHeartbeat.updateMany({
    where: { serviceName, instanceId },
    data: { status: "STOPPED", heartbeatAt: now, stoppedAt: now },
  });
}

export async function readWorkerHealth(
  serviceName = PRIMARY_WORKER_SERVICE,
  now = new Date(),
  maxAgeMs = WORKER_HEARTBEAT_MAX_AGE_MS,
) {
  const row = await db.workerHeartbeat.findUnique({ where: { serviceName } });
  if (!row) {
    return {
      ok: false,
      serviceName,
      status: "MISSING",
      heartbeatAt: null,
      heartbeatAgeMs: null,
      instanceId: null,
      buildRevision: null,
    };
  }

  const heartbeatAgeMs = Math.max(0, now.getTime() - row.heartbeatAt.getTime());
  return {
    ok: row.status === "RUNNING" && heartbeatAgeMs <= maxAgeMs,
    serviceName: row.serviceName,
    status: row.status,
    heartbeatAt: row.heartbeatAt.toISOString(),
    heartbeatAgeMs,
    instanceId: row.instanceId,
    buildRevision: row.buildRevision,
  };
}

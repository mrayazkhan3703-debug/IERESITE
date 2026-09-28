import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { jobQueueMetrics, schedulerStatus, startScheduler, stopScheduler } from "@/server/jobs/outbox";
import { createServer } from "node:http";
import {
  markWorkerStarted,
  markWorkerStopped,
  markWorkerStopping,
  touchWorkerHeartbeat,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "@/server/jobs/worker-health";

const config = getConfig();

if (!config.JOB_SCHEDULER_ENABLED) {
  throw new Error("The worker requires JOB_SCHEDULER_ENABLED=true");
}

await db.$queryRaw`SELECT 1`;
await markWorkerStarted();
startScheduler();

let heartbeatWrite: Promise<unknown> | null = null;
const heartbeatTimer = setInterval(() => {
  if (heartbeatWrite) return;
  heartbeatWrite = touchWorkerHeartbeat()
    .catch((error) => console.error("[worker] heartbeat write failed", error))
    .finally(() => { heartbeatWrite = null; });
}, WORKER_HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

const server = createServer(async (request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    try {
      const queue = await jobQueueMetrics();
      const scheduler = schedulerStatus();
      const queueOk = queue.dead === 0 && queue.failed === 0;
      const serviceOk = scheduler.running;
      response.writeHead(serviceOk ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({
          status: serviceOk && queueOk ? "ok" : "degraded",
          service: "investment-experts-worker",
          appVersion: process.env.APP_VERSION?.trim() || "unknown",
          buildRevision: process.env.BUILD_REVISION?.trim() || "unknown",
          checks: {
            database: { ok: true },
            scheduler: { ok: serviceOk },
            jobQueue: { ok: queueOk },
          },
          scheduler,
          queue,
          uptimeSec: Math.round(process.uptime()),
      }));
    } catch {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({
          status: "degraded",
          service: "investment-experts-worker",
          appVersion: process.env.APP_VERSION?.trim() || "unknown",
          buildRevision: process.env.BUILD_REVISION?.trim() || "unknown",
          checks: { database: { ok: false } },
      }));
    }
});

server.listen(config.WORKER_HEALTH_PORT, "0.0.0.0", () => {
  console.log(`[worker] health endpoint listening on 0.0.0.0:${config.WORKER_HEALTH_PORT}`);
});

let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  if (shutdownPromise) return;
  shutdownPromise = (async () => {
    clearInterval(heartbeatTimer);
    if (heartbeatWrite) await heartbeatWrite;
    await markWorkerStopping().catch((error) => console.error("[worker] failed to mark stopping", error));
    await stopScheduler();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await markWorkerStopped().catch((error) => console.error("[worker] failed to mark stopped", error));
    await db.$disconnect();
  })();
  void shutdownPromise.catch((error) => {
    console.error("[worker] graceful shutdown failed", error);
    process.exitCode = 1;
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

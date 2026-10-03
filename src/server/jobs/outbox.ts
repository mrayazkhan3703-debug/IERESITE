import { JobDeferredError, releaseDeferredJob } from "./deferred";
/**
 * Transactional outbox + job runner (ADR-007).
 * Domain events are written to outbox_events in the same transaction as business
 * writes; the scheduler drains them with idempotency, retry/backoff, timeout
 * classification, and DLQ. Production path: same handlers on BullMQ worker.
 */
import { db, parseJson, toJsonValue } from "@/lib/db";
import { getConfig } from "@/lib/config";
import type { JobRun, OutboxEvent, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { reindexProperty, rebuildIndex } from "@/server/search/service";
import { deliverLeadToCrm, syncLeadAssignmentToCrm, syncLeadStatusToCrm } from "@/server/crm/adapter";
import { processMediaJob } from "@/server/media/pipeline";
import { generateSitemap } from "@/server/seo/sitemap";
import { logEvent } from "@/server/rate-limit";
import { JobCancellationError, runCancellableJob } from "@/server/jobs/cancellation";
import { releaseJobAfterShutdown } from "@/server/jobs/lease";
import { storageWriteDeferral } from "@/server/storage/mutation-policy";

export const OUTBOX_EVENT_TYPES = [
  "property.updated",
  "property.published",
  "property.unpublished",
  "listing.updated",
  "project.updated",
  "community.updated",
  "developer.updated",
  "agent.updated",
  "agent.created",
  "lead.created",
  "lead.updated",
  "lead.assignment_changed",
  "lead.status_changed",
  "media.uploaded",
  "media.updated",
  "content.published",
  "content.updated",
  "market-report.published",
  "market-report.updated",
  "rag.document.published",
  "rag.document.updated",
  "rag.source.updated",
  "market.imported",
  "import.staged.requested",
  "search.reindex.requested",
  "user.invitation.created",
  "user.invitation.accepted",
  "user.updated",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

type JobClient = Pick<Prisma.TransactionClient, "jobRun">;
type OutboxClient = Pick<Prisma.TransactionClient, "outboxEvent">;

export async function emitEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: OutboxEventType,
  payload: Record<string, unknown> = {},
  client: OutboxClient = db,
) {
  return client.outboxEvent.create({
    data: {
      aggregateType,
      aggregateId,
      eventType,
      payloadJson: toJsonValue(payload),
    },
  });
}

/* Job handlers registry — each declares its contract (PART K) ---------------- */

interface JobContext {
  payload: Record<string, unknown>;
  signal: AbortSignal;
}

interface JobHandler {
  key: string;
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
  handle: (ctx: JobContext) => Promise<void>;
}

const exponential = (base = 5000) => (attempt: number) => Math.min(base * 2 ** (attempt - 1), 15 * 60_000);

export const JOB_HANDLERS: JobHandler[] = [
  {
    key: "cms.public-index.refresh",
    timeoutMs: 60_000,
    maxAttempts: 3,
    backoffMs: exponential(5000),
    handle: async () => {
      await Promise.all([rebuildIndex(), generateSitemap()]);
    },
  },
  {
    key: "search.index.property",
    timeoutMs: 15_000,
    maxAttempts: 5,
    backoffMs: exponential(2000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const propertyId = String(payload.propertyId ?? "");
      if (!propertyId) throw new Error("propertyId required");
      await reindexProperty(propertyId);
    },
  },
  {
    key: "search.reindex.all",
    timeoutMs: 120_000,
    maxAttempts: 2,
    backoffMs: exponential(5000),
    handle: async () => {
      await rebuildIndex();
    },
  },
  {
    key: "crm.lead.deliver",
    timeoutMs: 30_000,
    maxAttempts: 5,
    backoffMs: exponential(15_000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const leadId = String(payload.leadId ?? "");
      if (!leadId) throw new Error("leadId required");
      await deliverLeadToCrm(leadId, { signal });
    },
  },
  {
    key: "crm.lead.assignment.sync",
    timeoutMs: 30_000,
    maxAttempts: 5,
    backoffMs: exponential(15_000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const leadId = String(payload.leadId ?? "");
      if (!leadId) throw new Error("leadId required");
      await syncLeadAssignmentToCrm(leadId, signal);
    },
  },
  {
    key: "crm.lead.status.sync",
    timeoutMs: 30_000,
    maxAttempts: 5,
    backoffMs: exponential(15_000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const leadId = String(payload.leadId ?? "");
      if (!leadId) throw new Error("leadId required");
      await syncLeadStatusToCrm(leadId, signal);
    },
  },
  {
    key: "media.process",
    timeoutMs: 120_000,
    maxAttempts: 3,
    backoffMs: exponential(5000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const mediaId = String(payload.mediaId ?? "");
      await processMediaJob(mediaId, signal);
    },
  },
  {
    key: "seo.sitemap.generate",
    timeoutMs: 60_000,
    maxAttempts: 2,
    backoffMs: exponential(5000),
    handle: async () => {
      await generateSitemap();
    },
  },
  {
    key: "rag.embed.document",
    timeoutMs: 120_000,
    maxAttempts: 3,
    backoffMs: exponential(5000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const { rebuildDocumentIndex } = await import("@/server/rag/pipeline");
      const documentId = String(payload.documentId ?? "");
      const version = Number(payload.documentVersion);
      const expectedVersion = Number.isSafeInteger(version) && version > 0 ? version : undefined;
      await rebuildDocumentIndex(documentId, expectedVersion, signal);
    },
  },
  {
    key: "rag.reconcile.source",
    timeoutMs: 120_000,
    maxAttempts: 3,
    backoffMs: exponential(5000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const { reconcileRagSourceIndex } = await import("@/server/rag/pipeline");
      const sourceId = String(payload.sourceId ?? "");
      if (!sourceId) throw new Error("sourceId required");
      await reconcileRagSourceIndex(sourceId, signal, typeof payload.afterId === "string" ? payload.afterId : undefined);
    },
  },
  {
    key: "ingestion.import.process",
    timeoutMs: 60 * 60_000,
    maxAttempts: 5,
    backoffMs: exponential(10_000),
    handle: async ({ payload, signal }) => {
      signal.throwIfAborted();
      const importRunId = String(payload.importRunId ?? "");
      if (!importRunId) throw new Error("importRunId required");
      const { processStagedImport } = await import("@/server/ingestion/staged");
      await processStagedImport(importRunId, { signal });
    },
  },
  {
    key: "alerts.savedSearch.match",
    timeoutMs: 60_000,
    maxAttempts: 2,
    backoffMs: exponential(10_000),
    handle: async ({ signal }) => {
      signal.throwIfAborted();
      const { matchSavedSearches } = await import("@/server/alerts/matcher");
      await matchSavedSearches(signal);
    },
  },
];

const handlerByKey = new Map(JOB_HANDLERS.map((h) => [h.key, h]));

/** Outbox event → job mapping */
export function mapOutboxEventToJob(eventId: string, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>): { key: string; payload: Record<string, unknown>; idempotencyKey: string } | null {
  switch (eventType) {
    case "property.updated":
    case "property.published":
    case "property.unpublished":
    case "listing.updated":
      return { key: "search.index.property", payload: { propertyId: aggregateId }, idempotencyKey: `outbox:${eventId}:search.index.property` };
    case "project.updated":
    case "community.updated":
    case "developer.updated":
      return { key: "cms.public-index.refresh", payload: {}, idempotencyKey: `outbox:${eventId}:cms.public-index.refresh` };
    case "market.imported":
    case "search.reindex.requested":
      return { key: "search.reindex.all", payload: {}, idempotencyKey: `outbox:${eventId}:search.reindex.all` };
    case "import.staged.requested":
      return { key: "ingestion.import.process", payload: { importRunId: aggregateId }, idempotencyKey: `import:${aggregateId}:process` };
    case "lead.created":
      return { key: "crm.lead.deliver", payload: { leadId: aggregateId }, idempotencyKey: `outbox:${eventId}:crm.lead.deliver` };
    case "lead.assignment_changed":
      return { key: "crm.lead.assignment.sync", payload: { leadId: aggregateId }, idempotencyKey: `outbox:${eventId}:crm.lead.assignment.sync` };
    case "lead.status_changed":
      return { key: "crm.lead.status.sync", payload: { leadId: aggregateId }, idempotencyKey: `outbox:${eventId}:crm.lead.status.sync` };
    case "lead.updated":
      // Intentional noop until bidirectional GHL update semantics are defined.
      return null;
    case "user.invitation.created":
    case "user.invitation.accepted":
    case "user.updated":
      // Intentional noop: invitation mail is sent after commit; these events are durable integration hooks.
      return null;
    case "media.uploaded":
      return { key: "media.process", payload: { mediaId: aggregateId }, idempotencyKey: `outbox:${eventId}:media.process` };
    case "agent.created":
    case "agent.updated":
    case "media.updated":
    case "content.updated":
    case "content.published":
    case "market-report.updated":
    case "market-report.published":
      return { key: "seo.sitemap.generate", payload: {}, idempotencyKey: `outbox:${eventId}:seo.sitemap.generate` };
    case "rag.document.published":
      {
        const documentVersion = Number(payload.documentVersion);
        return {
          key: "rag.embed.document",
          payload: { documentId: aggregateId, ...(Number.isSafeInteger(documentVersion) && documentVersion > 0 ? { documentVersion } : {}) },
          idempotencyKey: `outbox:${eventId}:rag.embed.document`,
        };
      }
    case "rag.document.updated":
      return null;
    case "rag.source.updated":
      return { key: "rag.reconcile.source", payload: { sourceId: aggregateId }, idempotencyKey: `outbox:${eventId}:rag.reconcile.source` };
    default:
      throw new Error(`Unhandled outbox event type: ${eventType} (${aggregateType})`);
  }
}

/* Scheduler ------------------------------------------------------------------- */

let timer: ReturnType<typeof setInterval> | null = null;
let initialTickTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let heartbeat = 0;
let schedulerAbortController: AbortController | null = null;
let activeTick: Promise<void> | null = null;
let activeJob: { id: string; key: string; startedAt: number } | null = null;

// Dev-mode module duplication guard: scheduler state on globalThis
const g = globalThis as unknown as {
  __ieSchedulerTimer?: ReturnType<typeof setInterval> | null;
  __ieSchedulerInitialTickTimer?: ReturnType<typeof setTimeout> | null;
  __ieSchedulerAbortController?: AbortController | null;
  __ieSchedulerTick?: Promise<void> | null;
  __ieSchedulerHeartbeat?: number;
};

export function startScheduler() {
  const config = getConfig();
  if (!config.JOB_SCHEDULER_ENABLED) return;
  if (timer || g.__ieSchedulerTimer) {
    timer = timer ?? g.__ieSchedulerTimer ?? null;
    return;
  }
  const controller = new AbortController();
  schedulerAbortController = controller;
  g.__ieSchedulerAbortController = controller;
  const tick = (): Promise<void> => {
    if (draining || controller.signal.aborted) return Promise.resolve();
    draining = true;
    heartbeat = Date.now();
    g.__ieSchedulerHeartbeat = heartbeat;
    const signal = controller.signal;
    const currentTick = (async () => {
      try {
        await drainOutbox(signal);
        if (!signal.aborted) await runScheduledJobs(signal);
        if (!signal.aborted) await processJobQueue(signal);
      } catch (err) {
        if (!signal.aborted) logEvent("jobs.scheduler_error", { error: String(err) });
      }
    })();
    activeTick = currentTick;
    g.__ieSchedulerTick = currentTick;
    void currentTick.finally(() => {
      if (activeTick === currentTick) activeTick = null;
      if (g.__ieSchedulerTick === currentTick) g.__ieSchedulerTick = null;
      draining = false;
    });
    return currentTick;
  };
  timer = setInterval(tick, config.JOB_INTERVAL_MS);
  g.__ieSchedulerTimer = timer;
  // don't block process exit
  if (typeof timer === "object" && "unref" in timer) (timer as { unref: () => void }).unref();
  initialTickTimer = setTimeout(() => { void tick(); }, 3000);
  g.__ieSchedulerInitialTickTimer = initialTickTimer;
  if (typeof initialTickTimer === "object" && "unref" in initialTickTimer) initialTickTimer.unref();
  logEvent("jobs.scheduler_started", { intervalMs: config.JOB_INTERVAL_MS });
}

/** Stop new ticks, abort active job work, and await the in-flight scheduler tick. */
export async function stopScheduler(): Promise<void> {
  const currentTimer = timer ?? g.__ieSchedulerTimer ?? null;
  const currentInitialTimer = initialTickTimer ?? g.__ieSchedulerInitialTickTimer ?? null;
  if (currentTimer) clearInterval(currentTimer);
  if (currentInitialTimer) clearTimeout(currentInitialTimer);
  timer = null;
  initialTickTimer = null;
  g.__ieSchedulerTimer = null;
  g.__ieSchedulerInitialTickTimer = null;

  const controller = schedulerAbortController ?? g.__ieSchedulerAbortController ?? null;
  controller?.abort(new JobCancellationError("shutdown"));
  const tick = activeTick ?? g.__ieSchedulerTick ?? null;
  if (tick) await tick;
  schedulerAbortController = null;
  if (g.__ieSchedulerAbortController === controller) g.__ieSchedulerAbortController = null;
  logEvent("jobs.scheduler_stopped", {});
}

export function schedulerStatus() {
  const running = !!timer || !!g.__ieSchedulerTimer;
  const hb = heartbeat || g.__ieSchedulerHeartbeat || 0;
  return {
    running,
    draining,
    heartbeatAgeMs: hb ? Date.now() - hb : null,
    activeJob: activeJob ? {
      jobId: activeJob.id,
      key: activeJob.key,
      runningForMs: Date.now() - activeJob.startedAt,
    } : null,
  };
}

export async function jobQueueMetrics() {
  const [row] = await db.$queryRaw<Array<{
    queued: bigint;
    retrying: bigint;
    running: bigint;
    dead: bigint;
    failed: bigint;
    oldestDueAt: Date | null;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'QUEUED') AS "queued",
      COUNT(*) FILTER (WHERE "status" = 'RETRYING') AS "retrying",
      COUNT(*) FILTER (WHERE "status" = 'RUNNING') AS "running",
      COUNT(*) FILTER (WHERE "status" = 'DEAD') AS "dead",
      COUNT(*) FILTER (WHERE "status" = 'FAILED') AS "failed",
      MIN("scheduledAt") FILTER (WHERE "status" IN ('QUEUED', 'RETRYING') AND "scheduledAt" <= NOW()) AS "oldestDueAt"
    FROM "JobRun"
  `;
  const oldestDueMs = row?.oldestDueAt?.getTime();
  return {
    queued: Number(row?.queued ?? 0),
    retrying: Number(row?.retrying ?? 0),
    running: Number(row?.running ?? 0),
    dead: Number(row?.dead ?? 0),
    failed: Number(row?.failed ?? 0),
    oldestDueAgeSec: oldestDueMs ? Math.max(0, Math.floor((Date.now() - oldestDueMs) / 1000)) : null,
  };
}

function jobLogIdentity(job: Pick<JobRun, "id" | "idempotencyKey">) {
  const outboxEventId = /^outbox:([^:]+):/.exec(job.idempotencyKey)?.[1];
  return { jobId: job.id, correlationId: outboxEventId ?? job.id };
}

export async function drainOutbox(signal?: AbortSignal) {
  for (let index = 0; index < 50; index += 1) {
    signal?.throwIfAborted();
    const result = await db.$transaction(async (tx) => {
      const events = await tx.$queryRaw<OutboxEvent[]>`
        SELECT * FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const ev = events[0];
      if (!ev) return { processed: false, error: null };
      try {
        const payload = parseJson<Record<string, unknown>>(ev.payloadJson, {});
        const job = mapOutboxEventToJob(ev.id, ev.eventType, ev.aggregateType, ev.aggregateId, payload);
        if (job) {
          await enqueueJob(job.key, job.payload, job.idempotencyKey, new Date(), tx);
        }
        await tx.outboxEvent.update({ where: { id: ev.id }, data: { publishedAt: new Date(), lastError: null } });
        return { processed: true, error: null };
      } catch (err) {
        const error = String(err).slice(0, 500);
        await tx.outboxEvent.update({
          where: { id: ev.id },
          data: { attemptCount: { increment: 1 }, lastError: error },
        });
        return { processed: false, error };
      }
    });
    if (!result.processed) {
      if (result.error) logEvent("outbox.dispatch_error", { error: result.error.slice(0, 200) });
      break;
    }
  }
}

async function runScheduledJobs(signal?: AbortSignal) {
  signal?.throwIfAborted();
  // saved-search matching every ~5 minutes
  const last = await db.jobRun.findFirst({
    where: { jobKey: "alerts.savedSearch.match", status: "SUCCEEDED" },
    orderBy: { finishedAt: "desc" },
  });
  if (!last || Date.now() - (last.finishedAt?.getTime() ?? 0) > 5 * 60_000) {
    await enqueueJob("alerts.savedSearch.match", {}, `alerts:${Math.floor(Date.now() / 300000)}`);
  }
}

export async function enqueueJob(key: string, payload: Record<string, unknown>, idempotencyKey: string, scheduledAt = new Date(), client: JobClient = db) {
  const handler = handlerByKey.get(key);
  const data = {
      jobKey: key,
      payloadJson: toJsonValue(payload),
      idempotencyKey,
      status: "QUEUED",
      scheduledAt,
      maxAttempts: handler?.maxAttempts ?? 3,
  };
  return client.jobRun.upsert({
    where: { idempotencyKey },
    create: data,
    update: {},
  });
}

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}:${process.pid}:${randomUUID()}`;

export async function processJobQueue(signal?: AbortSignal) {
  if (signal?.aborted) return;
  await db.$executeRaw`
    UPDATE "JobRun"
    SET "status" = 'RETRYING',
        "lockedBy" = NULL,
        "lockedAt" = NULL,
        "leaseExpiresAt" = NULL,
        "error" = COALESCE("error", 'Recovered after worker lease expiry'),
        "updatedAt" = NOW()
    WHERE "status" = 'RUNNING'
      AND "leaseExpiresAt" < NOW()
  `;

  while (!signal?.aborted) {
    const due = await db.$queryRaw<JobRun[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "JobRun"
        WHERE "status" IN ('QUEUED', 'RETRYING')
          AND "scheduledAt" <= NOW()
        ORDER BY "scheduledAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "JobRun" AS job
      SET "status" = 'RUNNING',
          "startedAt" = COALESCE(job."startedAt", NOW()),
          "attempts" = job."attempts" + 1,
          "heartbeatAt" = NOW(),
          "lockedBy" = ${WORKER_ID},
          "lockedAt" = NOW(),
          "leaseExpiresAt" = NOW() + INTERVAL '5 minutes',
          "updatedAt" = NOW()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job.*
    `;
    const job = due[0];
    if (!job) return;
    if (signal?.aborted) {
      await releaseJobAfterShutdown(db, job.id, WORKER_ID);
      return;
    }

    const handler = handlerByKey.get(job.jobKey);
    if (!handler) {
      await db.jobRun.update({ where: { id: job.id }, data: { status: "FAILED", error: "No handler registered", finishedAt: new Date(), lockedBy: null, lockedAt: null, leaseExpiresAt: null } });
      logEvent("job.failed", { ...jobLogIdentity(job), key: job.jobKey, attempt: job.attempts, failureClass: "MissingHandler" });
      continue;
    }
    const payload = parseJson<Record<string, unknown>>(job.payloadJson, {});
    const started = Date.now();
    activeJob = { id: job.id, key: job.jobKey, startedAt: started };
    const identity = jobLogIdentity(job);
    logEvent("job.started", { ...identity, key: job.jobKey, attempt: job.attempts, maxAttempts: handler.maxAttempts });
    const leaseHeartbeat = setInterval(() => {
      const now = new Date();
      void db.jobRun.updateMany({
        where: { id: job.id, status: "RUNNING", lockedBy: WORKER_ID },
        data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + 5 * 60_000) },
      }).catch((error) => logEvent("job.heartbeat_error", { ...identity, key: job.jobKey, failureClass: error instanceof Error ? error.name : "UnknownFailure" }));
    }, 60_000);
    try {
      await runCancellableJob((jobSignal) => handler.handle({ payload, signal: jobSignal }), {
        timeoutMs: handler.timeoutMs,
        parentSignal: signal,
      });
      await db.jobRun.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), durationMs: Date.now() - started, lockedBy: null, lockedAt: null, leaseExpiresAt: null },
      });
      logEvent("job.succeeded", { ...identity, key: job.jobKey, durationMs: Date.now() - started, attempt: job.attempts });
    } catch (err) {
      if (err instanceof JobCancellationError && err.kind === "shutdown") {
        await releaseJobAfterShutdown(db, job.id, WORKER_ID);
        logEvent("job.cancelled", { ...identity, key: job.jobKey, reason: "shutdown" });
        return;
      }
      const deferred = err instanceof JobDeferredError ? err : storageWriteDeferral(err);
      if (deferred) {
        await releaseDeferredJob(db, job.id, WORKER_ID, deferred);
        logEvent("job.deferred", { ...identity, key: job.jobKey, reason: deferred.code });
        continue;
      }
      const attempts = job.attempts;
      const isTimeout = err instanceof JobCancellationError && err.kind === "timeout";
      const dead = attempts >= handler.maxAttempts;
      if (dead) {
        await db.jobRun.update({
          where: { id: job.id },
          data: { status: "DEAD", error: String(err).slice(0, 500), finishedAt: new Date(), lockedBy: null, lockedAt: null, leaseExpiresAt: null },
        });
        await db.deadLetterEvent.create({
          data: {
            jobKey: job.jobKey,
            sourceId: job.id,
            payloadJson: toJsonValue(job.payloadJson),
            error: String(err).slice(0, 500),
            attempts,
          },
        });
        if (job.jobKey === "ingestion.import.process" && typeof payload.importRunId === "string") {
          await db.importRun.updateMany({
            where: { id: payload.importRunId, status: { in: ["QUEUED", "RUNNING"] } },
            data: { status: "FAILED", error: "Import worker exhausted retries; inspect its dead-letter record.", finishedAt: new Date() },
          });
        }
        logEvent("job.dead_letter", { ...identity, key: job.jobKey, failureClass: err instanceof Error ? err.name : "UnknownFailure" });
      } else {
        const backoff = handler.backoffMs(attempts);
        await db.jobRun.update({
          where: { id: job.id },
          data: { status: "RETRYING", error: String(err).slice(0, 500), scheduledAt: new Date(Date.now() + backoff), lockedBy: null, lockedAt: null, leaseExpiresAt: null },
        });
        logEvent("job.retry", { ...identity, key: job.jobKey, attempt: attempts, backoffMs: backoff, isTimeout, failureClass: err instanceof Error ? err.name : "UnknownFailure" });
      }
    } finally {
      clearInterval(leaseHeartbeat);
      if (activeJob?.id === job.id) activeJob = null;
    }
  }
}

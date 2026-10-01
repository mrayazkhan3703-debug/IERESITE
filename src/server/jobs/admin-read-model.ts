import type { DeadLetterEvent, JobRun, OutboxEvent, Prisma } from "@prisma/client";
import { safeOperationalError } from "@/server/jobs/safe-error";

// The visual Jobs panel needs metadata and the DLQ error, never a payload body.
// Keep selection narrow so sensitive payloads are not even loaded into this read path.
export const adminJobRunSelect = {
  id: true, jobKey: true, status: true, attempts: true, maxAttempts: true,
  scheduledAt: true, startedAt: true, finishedAt: true, durationMs: true, error: true,
} as const satisfies Prisma.JobRunSelect;

export const adminDeadLetterSelect = {
  id: true, jobKey: true, error: true, attempts: true, createdAt: true,
} as const satisfies Prisma.DeadLetterEventSelect;

export const adminOutboxSelect = {
  id: true, eventType: true, aggregateType: true, publishedAt: true,
  attemptCount: true, lastError: true,
} as const satisfies Prisma.OutboxEventSelect;

type AdminJobRun = Pick<JobRun,
  "id" | "jobKey" | "status" | "attempts" | "maxAttempts" |
  "scheduledAt" | "startedAt" | "finishedAt" | "durationMs" | "error">;

type AdminDeadLetter = Pick<DeadLetterEvent,
  "id" | "jobKey" | "error" | "attempts" | "createdAt">;

type AdminOutbox = Pick<OutboxEvent,
  "id" | "eventType" | "aggregateType" | "publishedAt" | "attemptCount" | "lastError">;

export function adminJobRunView(row: AdminJobRun) {
  return {
    id: row.id, jobKey: row.jobKey, status: row.status,
    attempts: row.attempts, maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs, error: safeOperationalError(row.error),
  };
}

export function adminDeadLetterView(row: AdminDeadLetter) {
  return {
    id: row.id, jobKey: row.jobKey, error: safeOperationalError(row.error),
    attempts: row.attempts, createdAt: row.createdAt.toISOString(),
  };
}

export function adminOutboxView(row: AdminOutbox) {
  return {
    id: row.id, eventType: row.eventType, aggregateType: row.aggregateType,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    attemptCount: row.attemptCount, lastError: safeOperationalError(row.lastError),
  };
}

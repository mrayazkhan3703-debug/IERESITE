import { expect, test } from "bun:test";
import { adminDeadLetterSelect, adminDeadLetterView, adminJobRunSelect, adminJobRunView, adminOutboxSelect, adminOutboxView } from "@/server/jobs/admin-read-model";

test("visual Jobs selections never load queue payloads, worker identity or replay source", () => {
  expect(Object.keys(adminJobRunSelect).sort()).toEqual([
    "attempts", "durationMs", "error", "finishedAt", "id", "jobKey", "maxAttempts", "scheduledAt", "startedAt", "status",
  ]);
  expect(Object.keys(adminDeadLetterSelect).sort()).toEqual(["attempts", "createdAt", "error", "id", "jobKey"]);
  expect(Object.keys(adminOutboxSelect).sort()).toEqual(["aggregateType", "attemptCount", "eventType", "id", "lastError", "publishedAt"]);
  for (const selection of [adminJobRunSelect, adminDeadLetterSelect, adminOutboxSelect]) {
    expect(selection).not.toHaveProperty("payloadJson");
    expect(selection).not.toHaveProperty("idempotencyKey");
    expect(selection).not.toHaveProperty("sourceId");
  }
});

test("recent outbox summary omits the unused event payload", () => {
  const row = {
    id: "synthetic-event", eventType: "media.uploaded", aggregateType: "media",
    publishedAt: null, attemptCount: 1, lastError: null,
    payloadJson: { secret: "SYNTHETIC-NO-EXPOSURE" }, aggregateId: "SYNTHETIC-NO-EXPOSURE",
  };
  const view = adminOutboxView(row);
  expect(view).toEqual({
    id: "synthetic-event", eventType: "media.uploaded", aggregateType: "media",
    publishedAt: null, attemptCount: 1, lastError: null,
  });
  expect(JSON.stringify(view)).not.toContain("SYNTHETIC-NO-EXPOSURE");
});

test("job summary keeps visual fields but cannot serialize an extra raw payload", () => {
  const row = {
    id: "synthetic-job", jobKey: "media.process", status: "DEAD", attempts: 3, maxAttempts: 3,
    scheduledAt: new Date("2026-09-27T10:00:00Z"), startedAt: null,
    finishedAt: new Date("2026-09-27T10:01:00Z"), durationMs: 1000,
    error: "Synthetic test failure", payloadJson: { secret: "SYNTHETIC-NO-EXPOSURE" },
    idempotencyKey: "SYNTHETIC-NO-EXPOSURE", lockedBy: "SYNTHETIC-NO-EXPOSURE",
  };
  const view = adminJobRunView(row);
  expect(view.status).toBe("DEAD");
  expect(view.scheduledAt).toBe("2026-09-27T10:00:00.000Z");
  expect(view.startedAt).toBeNull();
  expect(JSON.stringify(view)).not.toContain("SYNTHETIC-NO-EXPOSURE");
});

test("DLQ summary preserves human-review metadata and omits raw payload, source and replay marker", () => {
  const row = {
    id: "synthetic-letter", jobKey: "media.process", error: "Synthetic test failure", attempts: 3,
    createdAt: new Date("2026-09-27T10:00:00Z"),
    payloadJson: { secret: "SYNTHETIC-NO-EXPOSURE" }, sourceId: "SYNTHETIC-NO-EXPOSURE",
    replayedAt: null, resolvedNote: "SYNTHETIC-NO-EXPOSURE",
  };
  const view = adminDeadLetterView(row);
  expect(view).toEqual({
    id: "synthetic-letter", jobKey: "media.process", error: "Processing failed. Review the protected server logs for details.",
    attempts: 3, createdAt: "2026-09-27T10:00:00.000Z",
  });
  expect(JSON.stringify(view)).not.toContain("SYNTHETIC-NO-EXPOSURE");
});

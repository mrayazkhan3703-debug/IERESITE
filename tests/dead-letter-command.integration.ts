import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { replayDeadLetterCommand } from "@/server/domain/dead-letter-command";

const prefix = `dlq-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "dlq-command@example.invalid", name: "DLQ command integration",
  organizationId: null, roles: ["ADMIN"], permissions: ["jobs:update"], mfaVerified: true,
};

async function cleanup() {
  const items = await db.deadLetterEvent.findMany({ where: { sourceId: { startsWith: prefix } }, select: { id: true } });
  const ids = items.map((item) => item.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceType: "dead_letter", resourceId: { in: ids } } });
    await db.jobRun.deleteMany({ where: { idempotencyKey: { in: ids.map((id) => `replay:${id}`) } } });
    await db.deadLetterEvent.deleteMany({ where: { id: { in: ids } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional dead-letter replay command", () => {
  test("atomically queues one stable replay, marks the item, and writes an audit", async () => {
    const item = await db.deadLetterEvent.create({ data: {
      jobKey: "seo.sitemap.generate", sourceId: `${prefix}-source`, payloadJson: { fixture: prefix }, error: "fixture failure", attempts: 3,
    } });
    const result = await replayDeadLetterCommand(actor, item.id, "127.0.0.1", new Date(Date.now() + 60_000));
    const replayed = await db.deadLetterEvent.findUniqueOrThrow({ where: { id: item.id } });
    const job = await db.jobRun.findUniqueOrThrow({ where: { idempotencyKey: `replay:${item.id}` } });
    const audit = await db.auditLog.findFirstOrThrow({ where: { resourceType: "dead_letter", resourceId: item.id, action: "job.dlq.replay" } });
    expect(result.ok).toBe(true);
    expect(replayed.replayedAt?.toISOString()).toBe(result.replayedAt);
    expect(job.jobKey).toBe("seo.sitemap.generate");
    expect(job.payloadJson).toEqual({ fixture: prefix });
    expect(JSON.parse(audit.beforeJson ?? "null")).toMatchObject({ jobKey: item.jobKey, replayedAt: null });
    expect(JSON.parse(audit.afterJson ?? "null")).toMatchObject({ jobKey: item.jobKey });

    await expect(replayDeadLetterCommand(actor, item.id, null)).rejects.toMatchObject({ status: 409, code: "DLQ_ALREADY_REPLAYED" });
    expect(await db.auditLog.count({ where: { resourceType: "dead_letter", resourceId: item.id, action: "job.dlq.replay" } })).toBe(1);
    expect(await db.jobRun.count({ where: { idempotencyKey: `replay:${item.id}` } })).toBe(1);
  });
});

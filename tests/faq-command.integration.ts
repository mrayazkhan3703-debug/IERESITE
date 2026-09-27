import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createFaqCommand, updateFaqCommand } from "@/server/domain/faq-command";

const prefix = `faq-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "faq-command@example.invalid", name: "FAQ command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["content:update"], mfaVerified: true,
};
const question = "What does the integration fixture verify?";

async function cleanup() {
  const entries = await db.faq.findMany({ where: { question: { contains: prefix } }, select: { id: true } });
  const ids = entries.map((entry) => entry.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.faq.deleteMany({ where: { id: { in: ids } } });
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

describe("transactional FAQ command", () => {
  test("creates and edits locale-specific plain text with reversible visibility and audit history", async () => {
    const created = await createFaqCommand(actor, {
      groupKey: "GENERAL", locale: "ar", question: `${prefix} ${question}`, answer: "Fixture answer only.", sortOrder: 4, isActive: true,
    }, "127.0.0.1");
    const before = await db.faq.findUniqueOrThrow({ where: { id: created.id } });
    expect(before.locale).toBe("ar");
    expect(before.isActive).toBe(true);
    expect(await db.auditLog.count({ where: { resourceId: before.id, action: "faq.create" } })).toBe(1);

    const result = await updateFaqCommand(actor, {
      faqId: before.id, expectedUpdatedAt: before.updatedAt.toISOString(), groupKey: before.groupKey as "GENERAL",
      locale: "ar", question: before.question, answer: "Updated fixture answer.", sortOrder: 5, isActive: false,
    }, null);
    const after = await db.faq.findUniqueOrThrow({ where: { id: before.id } });
    expect(result.ok).toBe(true);
    expect(after.isActive).toBe(false);
    expect(after.sortOrder).toBe(5);
    expect(await db.auditLog.count({ where: { resourceId: before.id, action: "faq.update" } })).toBe(1);

    await expect(updateFaqCommand(actor, {
      faqId: before.id, expectedUpdatedAt: before.updatedAt.toISOString(), groupKey: "GENERAL", locale: "ar",
      question: before.question, answer: "Stale answer.", sortOrder: 6, isActive: true,
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect((await db.faq.findUniqueOrThrow({ where: { id: before.id } })).answer).toBe("Updated fixture answer.");
  });
});

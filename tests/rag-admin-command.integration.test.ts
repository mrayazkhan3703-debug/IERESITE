import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import {
  createRagDocument,
  createRagSource,
  reviewRagDocument,
  reviewRagSource,
  updateRagDocument,
} from "@/server/domain/rag-admin-command";

const prefix = `test-rag-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const editorId = `${prefix}-editor`;
const reviewerId = `${prefix}-reviewer`;
const editor: SessionUser = {
  sessionId: `${prefix}-editor-session`, id: editorId, email: `${editorId}@example.invalid`, name: "RAG editor",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};
const reviewer: SessionUser = {
  sessionId: `${prefix}-reviewer-session`, id: reviewerId, email: `${reviewerId}@example.invalid`, name: "RAG reviewer",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};

async function cleanup() {
  const documents = await db.ragDocument.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  const sources = await db.ragSource.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  const aggregateIds = [...documents.map((row) => row.id), ...sources.map((row) => row.id)];
  const outbox = await db.outboxEvent.findMany({ where: { aggregateId: { in: aggregateIds } }, select: { id: true } });
  const jobKeys = outbox.flatMap((event) => [
    `outbox:${event.id}:rag.embed.document`,
    `outbox:${event.id}:rag.reconcile.source`,
  ]);
  await db.jobRun.deleteMany({ where: { idempotencyKey: { in: jobKeys } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
  await db.auditLog.deleteMany({ where: { resourceId: { in: aggregateIds } } });
  await db.ragDocument.deleteMany({ where: { id: { in: documents.map((row) => row.id) } } });
  await db.ragSource.deleteMany({ where: { id: { in: sources.map((row) => row.id) } } });
  await db.user.deleteMany({ where: { id: { in: [editorId, reviewerId] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.createMany({ data: [
    { id: editorId, email: editor.email },
    { id: reviewerId, email: reviewer.email },
  ] });
});
afterAll(async () => { await cleanup(); await db.$disconnect(); });

describe("visual RAG source/document commands", () => {
  it("requires distinct approval, versions drafts, withdraws edited content, and records indexing events", async () => {
    const now = Date.now();
    const sourceCreated = await createRagSource(editor, {
      title: `${prefix} internal calculation method`,
      sourceType: "INTERNAL_DOC",
      trustTier: "INTERNAL",
      verifiedAt: new Date(now - 86_400_000).toISOString(),
      freshnessReviewDueAt: new Date(now + 30 * 86_400_000).toISOString(),
      isActive: true,
    }, "127.0.0.1");
    let source = await db.ragSource.findUniqueOrThrow({ where: { id: sourceCreated.id } });
    expect(source.isApproved).toBe(false);
    expect(await db.auditLog.count({ where: { resourceId: source.id, action: "rag_source.create_draft" } })).toBe(1);

    const input = {
      sourceId: source.id,
      title: `${prefix} reviewed method`,
      slug: `${prefix}-method`,
      locale: "en" as const,
      content: "Citrine lantern retrieval fixture. This synthetic paragraph is only a local test and contains no real legal or property claim.",
      changeNote: "Synthetic integration fixture",
    };
    await expect(createRagDocument(editor, input, null)).rejects.toThrow();
    await expect(reviewRagSource(editor, source.id, source.updatedAt.toISOString(), "APPROVE", "self review", null)).rejects.toThrow();
    await expect(reviewRagSource(reviewer, source.id, source.updatedAt.toISOString(), "APPROVE", "   ", null)).rejects.toThrow("review note");

    await reviewRagSource(reviewer, source.id, source.updatedAt.toISOString(), "APPROVE", "Reviewed synthetic source metadata", null);
    source = await db.ragSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(source.isApproved).toBe(true);
    expect(source.approvedById).toBe(reviewer.id);

    const created = await createRagDocument(editor, input, null);
    let document = await db.ragDocument.findUniqueOrThrow({ where: { id: created.id } });
    expect(document.status).toBe("DRAFT");
    expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.ragDocumentRevision.count({ where: { documentId: document.id } })).toBe(1);
    await expect(reviewRagDocument(editor, document.id, document.updatedAt.toISOString(), "APPROVE", "self review", null)).rejects.toThrow();

    await reviewRagDocument(reviewer, document.id, document.updatedAt.toISOString(), "APPROVE", "Reviewed synthetic fixture", null);
    document = await db.ragDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(document.status).toBe("ACTIVE");
    expect(document.approvedById).toBe(reviewer.id);
    expect(await db.outboxEvent.count({ where: { aggregateId: document.id, eventType: "rag.document.published" } })).toBe(1);

    const staleVersion = document.updatedAt.toISOString();
    await updateRagDocument(editor, document.id, staleVersion, { ...input, content: `${input.content} Updated calculation explanation.` }, null);
    document = await db.ragDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(document.status).toBe("DRAFT");
    expect(document.approvedById).toBeNull();
    expect(document.version).toBe(2);
    expect(await db.ragChunk.count({ where: { documentId: document.id } })).toBe(0);
    expect(await db.ragDocumentRevision.count({ where: { documentId: document.id } })).toBe(2);
    await expect(updateRagDocument(editor, document.id, staleVersion, { ...input, content: `${input.content} stale update` }, null)).rejects.toThrow();

    await reviewRagDocument(reviewer, document.id, document.updatedAt.toISOString(), "RETIRE", "Retire synthetic draft", null);
    document = await db.ragDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(document.status).toBe("RETIRED");
    await reviewRagDocument(reviewer, document.id, document.updatedAt.toISOString(), "RESTORE", "Restore as draft", null);
    document = await db.ragDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(document.status).toBe("DRAFT");

    await reviewRagSource(reviewer, source.id, source.updatedAt.toISOString(), "REVOKE", "Synthetic review ended", null);
    source = await db.ragSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(source.isApproved).toBe(false);
    expect(await db.auditLog.count({ where: { resourceId: document.id, action: "rag_document.approve" } })).toBe(1);
  });
});

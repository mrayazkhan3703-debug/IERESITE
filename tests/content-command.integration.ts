import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createContentDraft, pairContentTranslations, retireContentEntry, rollbackContentDraft, reviewContentEntry, unlinkContentTranslation, updateContentDraft } from "@/server/domain/content-command";

const prefix = `content-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${prefix}-user`;
const reviewerId = `${prefix}-reviewer`;
const actor: SessionUser = {
  sessionId: `${prefix}-session`, id: userId, email: "content-command@example.invalid", name: "Content command integration",
  organizationId: null, roles: ["OWNER"], permissions: ["content:update"], mfaVerified: true,
};
const reviewer: SessionUser = {
  sessionId: `${prefix}-review-session`, id: reviewerId, email: "content-reviewer@example.invalid", name: "Content reviewer",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};

async function cleanup() {
  const entries = await db.contentEntry.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  const ids = entries.map((entry) => entry.id);
  if (ids.length) {
    const groups = await db.contentEntry.findMany({ where: { id: { in: ids }, translationGroupId: { not: null } }, select: { translationGroupId: true } });
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.contentEntry.deleteMany({ where: { id: { in: ids } } });
    await db.contentTranslationGroup.deleteMany({ where: { id: { in: groups.flatMap((group) => group.translationGroupId ? [group.translationGroupId] : []) } } });
  }
  await db.redirect.deleteMany({ where: { OR: [
    { fromPath: { contains: prefix } }, { toPath: { contains: prefix } },
  ] } });
  await db.mediaAsset.deleteMany({ where: { storageKey: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.deleteMany({ where: { id: reviewerId } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: userId, email: actor.email } });
  await db.user.create({ data: { id: reviewerId, email: reviewer.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional bilingual content command", () => {
  test("creates a locale-tagged revisioned draft, submits it for review, and restores history safely", async () => {
    const cover = await db.mediaAsset.create({ data: {
      storageKey: `${prefix}/cover-test.webp`, url: "/uploads/content-cover-test.webp",
      mimeType: "image/webp", sizeBytes: 900, kind: "IMAGE", isPrivate: false,
    } });
    const created = await createContentDraft(actor, {
      contentType: "GUIDE", locale: "ar", slug: `${prefix}-old`, title: "Arabic test draft", body: "# Draft\n\nText only.", coverMediaId: cover.id,
    }, "127.0.0.1");
    let entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    let revision = await db.contentRevision.findFirstOrThrow({ where: { contentEntryId: entry.id, version: 1 } });
    expect(entry.locale).toBe("ar");
    expect(entry.status).toBe("DRAFT");
    expect(entry.coverMediaId).toBe(cover.id);

    const updated = await updateContentDraft(actor, {
      contentEntryId: entry.id, expectedUpdatedAt: entry.updatedAt.toISOString(),
      slug: `${prefix}-new`, title: "Arabic draft submitted", excerpt: "Review summary", body: "# Updated\n\nChanged text.", submitForReview: true,
    }, null);
    expect(updated.status).toBe("IN_REVIEW");
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entry.reviewWorkflowState).toBe("PENDING_REVIEW");
    const oldRedirect = await db.redirect.findUnique({ where: { fromPath: `/ar/guides/${prefix}-old` } });
    expect(oldRedirect?.toPath).toBe(`/ar/guides/${prefix}-new`);

    const rollback = await rollbackContentDraft(actor, entry.id, revision.id, entry.updatedAt.toISOString(), null);
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(rollback.ok).toBe(true);
    expect(entry.title).toBe("Arabic test draft");
    expect(entry.coverMediaId).toBe(cover.id);
    expect(entry.status).toBe("DRAFT");
    const oldUrlRedirect = await db.redirect.findUnique({ where: { fromPath: `/ar/guides/${prefix}-old` } });
    const newUrlRedirect = await db.redirect.findUnique({ where: { fromPath: `/ar/guides/${prefix}-new` } });
    expect(oldUrlRedirect?.isActive).toBe(false);
    expect(newUrlRedirect?.toPath).toBe(`/ar/guides/${prefix}-old`);
    expect(await db.contentRevision.count({ where: { contentEntryId: entry.id } })).toBe(3);
    expect(await db.outboxEvent.count({ where: { aggregateId: entry.id, eventType: "content.updated" } })).toBe(3);
  });

  test("editing a published entry removes it from public status until reviewed again", async () => {
    const created = await createContentDraft(actor, {
      contentType: "ARTICLE", locale: "en", slug: `${prefix}-published`, title: "Published test article", body: "Original body.",
    }, null);
    await db.contentEntry.update({ where: { id: created.id }, data: { status: "PUBLISHED", reviewWorkflowState: "APPROVED", publishedAt: new Date(Date.now() - 60_000) } });
    const current = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const result = await updateContentDraft(actor, {
      contentEntryId: created.id, expectedUpdatedAt: current.updatedAt.toISOString(),
      slug: current.slug, title: current.title, body: "Edited body.",
    }, null);
    const after = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(result.status).toBe("IN_REVIEW");
    expect(after.publishedAt).toBeNull();
    expect(after.reviewWorkflowState).toBe("PENDING_REVIEW");
  });

  test("persists structured visual blocks into immutable revisions and restores them as a draft", async () => {
    const originalBlocks = [
      { type: "heading", level: 2, text: "Dubai market" },
      { type: "paragraph", text: "Editorial block content." },
    ];
    const created = await createContentDraft(actor, {
      contentType: "GUIDE", locale: "en", slug: `${prefix}-blocks`, title: "Structured content", body: "", blocks: originalBlocks,
    }, null);
    let entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const firstRevision = await db.contentRevision.findFirstOrThrow({ where: { contentEntryId: entry.id, version: 1 } });
    expect(JSON.parse(entry.bodyJson ?? "null")).toEqual(originalBlocks);
    expect(JSON.parse(firstRevision.snapshotJson).bodyJson).toBe(entry.bodyJson);

    await updateContentDraft(actor, {
      contentEntryId: entry.id, expectedUpdatedAt: entry.updatedAt.toISOString(), slug: entry.slug,
      title: entry.title, body: "", blocks: [{ type: "quote", text: "Changed block" }],
    }, null);
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: entry.id } });
    await rollbackContentDraft(actor, entry.id, firstRevision.id, entry.updatedAt.toISOString(), null);
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(JSON.parse(entry.bodyJson ?? "null")).toEqual(originalBlocks);
    expect(entry.status).toBe("DRAFT");
  });

  test("rejects unsafe rich-content links without creating an entry", async () => {
    await expect(createContentDraft(actor, {
      contentType: "ARTICLE", locale: "en", slug: `${prefix}-unsafe-block`, title: "Unsafe link", body: "",
      blocks: [{ type: "link", label: "Unsafe", href: "javascript:alert(1)" }],
    }, null)).rejects.toMatchObject({ status: 422, code: "CONTENT_BLOCKS_INVALID" });
    expect(await db.contentEntry.count({ where: { slug: `${prefix}-unsafe-block` } })).toBe(0);
  });

  test("retires public content reversibly without deleting its revisions", async () => {
    const created = await createContentDraft(actor, {
      contentType: "GUIDE", locale: "en", slug: `${prefix}-retire`, title: "Retire workflow", body: "Published content.",
    }, null);
    await db.contentEntry.update({ where: { id: created.id }, data: { status: "PUBLISHED", reviewWorkflowState: "APPROVED", publishedAt: new Date(Date.now() - 60_000) } });
    let entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const retired = await retireContentEntry(actor, entry.id, entry.updatedAt.toISOString(), true, null);
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(retired.status).toBe("RETIRED");
    expect(entry.status).toBe("RETIRED");
    expect(entry.publishedAt).toBeNull();
    expect(await db.contentRevision.count({ where: { contentEntryId: entry.id } })).toBe(2);

    const restored = await retireContentEntry(actor, entry.id, entry.updatedAt.toISOString(), false, null);
    entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(restored.status).toBe("DRAFT");
    expect(entry.status).toBe("DRAFT");
    expect(entry.publishedAt).toBeNull();
    expect(await db.contentRevision.count({ where: { contentEntryId: entry.id } })).toBe(3);
    expect(await db.auditLog.count({ where: { resourceId: entry.id, action: { in: ["content.retire", "content.restore_draft"] } } })).toBe(2);
  });

  test("requires a distinct reviewer before publication and emits a publish event", async () => {
    const created = await createContentDraft(actor, {
      contentType: "GUIDE", locale: "en", slug: `${prefix}-review`, title: "Review workflow draft", body: "Reviewed text.",
    }, null);
    const saved = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const submitted = await updateContentDraft(actor, {
      contentEntryId: created.id, expectedUpdatedAt: saved.updatedAt.toISOString(), slug: saved.slug,
      title: saved.title, body: saved.body, submitForReview: true,
    }, null);
    await expect(reviewContentEntry(actor, created.id, submitted.updatedAt, "APPROVE", "", null))
      .rejects.toMatchObject({ status: 409, code: "SELF_REVIEW_BLOCKED" });

    const approved = await reviewContentEntry(reviewer, created.id, submitted.updatedAt, "APPROVE", "Reviewed by a second staff member", null);
    expect(approved.reviewWorkflowState).toBe("APPROVED");
    const published = await reviewContentEntry(reviewer, created.id, approved.updatedAt, "PUBLISH", "", null);
    const entry = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(published.status).toBe("PUBLISHED");
    expect(entry.publishedAt).not.toBeNull();
    expect(entry.reviewWorkflowState).toBe("APPROVED");
    expect(await db.outboxEvent.count({ where: { aggregateId: created.id, eventType: "content.published" } })).toBe(1);
  });

  test("pairs existing English and Arabic entries transactionally and can safely unlink them", async () => {
    const englishDraft = await createContentDraft(actor, {
      contentType: "ARTICLE", locale: "en", slug: `${prefix}-translation-en`, title: "English article", body: "English text.",
    }, null);
    const arabicDraft = await createContentDraft(actor, {
      contentType: "ARTICLE", locale: "ar", slug: `${prefix}-translation-ar`, title: "Arabic article", body: "Arabic text.",
    }, null);
    const english = await db.contentEntry.findUniqueOrThrow({ where: { id: englishDraft.id } });
    const arabic = await db.contentEntry.findUniqueOrThrow({ where: { id: arabicDraft.id } });
    const linked = await pairContentTranslations(actor, english.id, english.updatedAt.toISOString(), arabic.id, arabic.updatedAt.toISOString(), null);
    const linkedEnglish = await db.contentEntry.findUniqueOrThrow({ where: { id: english.id } });
    const linkedArabic = await db.contentEntry.findUniqueOrThrow({ where: { id: arabic.id } });
    expect(linkedEnglish.translationGroupId).toBe(linked.translationGroupId);
    expect(linkedArabic.translationGroupId).toBe(linked.translationGroupId);
    expect(await db.auditLog.count({ where: { resourceId: { in: [english.id, arabic.id] }, action: "content.translation_pair" } })).toBe(2);

    await unlinkContentTranslation(actor, linkedEnglish.id, linkedEnglish.updatedAt.toISOString(), linkedArabic.updatedAt.toISOString(), null);
    const unlinkedEnglish = await db.contentEntry.findUniqueOrThrow({ where: { id: english.id } });
    const unlinkedArabic = await db.contentEntry.findUniqueOrThrow({ where: { id: arabic.id } });
    expect(unlinkedEnglish.translationGroupId).toBeNull();
    expect(unlinkedArabic.translationGroupId).toBeNull();
    expect(await db.contentTranslationGroup.findUnique({ where: { id: linked.translationGroupId } })).toBeNull();
    expect(await db.outboxEvent.count({ where: { aggregateId: { in: [english.id, arabic.id] }, eventType: "content.updated" } })).toBe(6);
  });

  test("rejects private or non-image assets as content covers", async () => {
    const privateAsset = await db.mediaAsset.create({ data: {
      storageKey: `${prefix}/private-test.pdf`, url: "private-object://content-test",
      mimeType: "application/pdf", sizeBytes: 1200, kind: "DOCUMENT", isPrivate: true,
    } });
    const publicDocument = await db.mediaAsset.create({ data: {
      storageKey: `${prefix}/public-document-test.pdf`, url: "/uploads/public-document-test.pdf",
      mimeType: "application/pdf", sizeBytes: 1400, kind: "DOCUMENT", isPrivate: false,
    } });
    await expect(createContentDraft(actor, {
      contentType: "ARTICLE", locale: "en", slug: `${prefix}-private-cover`, title: "Cover validation test", body: "Draft.", coverMediaId: privateAsset.id,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
    await expect(createContentDraft(actor, {
      contentType: "ARTICLE", locale: "en", slug: `${prefix}-document-cover`, title: "Document cover validation test", body: "Draft.", coverMediaId: publicDocument.id,
    }, null)).rejects.toMatchObject({ status: 422, code: "MEDIA_NOT_AVAILABLE" });
  });
});

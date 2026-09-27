import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { parseContentBlocks, readContentBlocks, type ContentBlock } from "@/lib/content-blocks";

type EditableContent = {
  contentType: string;
  locale: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  bodyJson: string | null;
  category: string | null;
  coverMediaId: string | null;
  status: string;
  reviewWorkflowState: string;
  publishedAt: Date | null;
};

export interface ContentDraftInput {
  contentEntryId: string;
  expectedUpdatedAt: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  body: string;
  blocks?: unknown;
  category?: string | null;
  coverMediaId?: string | null;
  submitForReview?: boolean;
}

export interface NewContentDraftInput {
  contentType: "GUIDE" | "AREA_GUIDE" | "ARTICLE" | "LANDING" | "FAQ_GROUP";
  locale: "en" | "ar";
  slug: string;
  title: string;
  excerpt?: string | null;
  body: string;
  blocks?: unknown;
  category?: string | null;
  coverMediaId?: string | null;
}

function contentPath(content: Pick<EditableContent, "contentType" | "locale" | "slug">) {
  const localePrefix = content.locale === "ar" ? "/ar" : "";
  const section = content.contentType === "GUIDE" || content.contentType === "AREA_GUIDE"
    ? "guides"
    : content.contentType === "MARKET_REPORT" ? "market/reports" : "insights";
  return `${localePrefix}/${section}/${content.slug}`;
}

function snapshot(content: EditableContent) {
  return JSON.stringify({
    contentType: content.contentType,
    locale: content.locale,
    slug: content.slug,
    title: content.title,
    excerpt: content.excerpt,
    body: content.body,
    bodyJson: content.bodyJson,
    category: content.category,
    coverMediaId: content.coverMediaId,
    status: content.status,
    reviewWorkflowState: content.reviewWorkflowState,
    publishedAt: content.publishedAt?.toISOString() ?? null,
  });
}

function ensureSlugAndTitle(slug: string, title: string) {
  if (!title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim().toLowerCase())) {
    throw new HttpError(422, "A title and URL-safe slug are required.", "CONTENT_VALIDATION");
  }
}

function ensureStandaloneReportIsManagedSeparately(contentType: string) {
  if (contentType === "MARKET_REPORT") {
    throw new HttpError(409, "Manage standalone market reports in the Market Reports Admin section.", "MARKET_REPORT_SEPARATE_CMS");
  }
}

async function ensurePublicImage(tx: Prisma.TransactionClient, mediaAssetId: string | null | undefined) {
  if (!mediaAssetId) return null;
  const media = await tx.mediaAsset.findFirst({ where: { id: mediaAssetId, isPrivate: false, kind: "IMAGE" }, select: { id: true } });
  if (!media) throw new HttpError(422, "Choose an available public image from the Media Library.", "MEDIA_NOT_AVAILABLE");
  return media.id;
}

function serializeContentBlocks(value: unknown): { json: string | null; blocks: ContentBlock[] | null } {
  if (value === undefined || value === null) return { json: null, blocks: null };
  const blocks = parseContentBlocks(value);
  if (!blocks) throw new HttpError(422, "One or more rich-content blocks are invalid or exceed the allowed size.", "CONTENT_BLOCKS_INVALID");
  return { json: blocks.length ? JSON.stringify(blocks) : null, blocks: blocks.length ? blocks : null };
}

async function ensurePublicBlockImages(tx: Prisma.TransactionClient, blocks: ContentBlock[] | null) {
  const ids = [...new Set((blocks ?? []).flatMap((block) => block.type === "image" ? [block.mediaId] : []))];
  if (!ids.length) return;
  const assets = await tx.mediaAsset.findMany({
    where: { id: { in: ids }, isPrivate: false, kind: "IMAGE", storageKey: { startsWith: "public/media/" } },
    select: { id: true },
  });
  if (assets.length !== ids.length) throw new HttpError(422, "Rich-content images must use available public Media Library images.", "MEDIA_NOT_AVAILABLE");
}

function blocksFromSnapshot(value: unknown): { json: string | null; blocks: ContentBlock[] | null } {
  if (value === undefined || value === null) return { json: null, blocks: null };
  if (typeof value !== "string") throw new HttpError(409, "This stored revision contains invalid structured content.", "INVALID_REVISION");
  try {
    return serializeContentBlocks(JSON.parse(value));
  } catch {
    throw new HttpError(409, "This stored revision contains invalid structured content.", "INVALID_REVISION");
  }
}

async function saveRevision(tx: Prisma.TransactionClient, entry: EditableContent & { id: string }, actor: SessionUser, note: string) {
  const currentVersion = await tx.contentRevision.aggregate({ where: { contentEntryId: entry.id }, _max: { version: true } });
  await tx.contentRevision.create({
    data: {
      contentEntryId: entry.id,
      version: (currentVersion._max.version ?? 0) + 1,
      snapshotJson: snapshot(entry),
      editedBy: actor.id,
      changeNote: note.slice(0, 300),
    },
  });
}

async function preserveSlug(tx: Prisma.TransactionClient, previous: EditableContent, next: EditableContent) {
  if (previous.slug === next.slug) return;
  const fromPath = contentPath(previous);
  const toPath = contentPath(next);
  // The target path is becoming canonical; retire any redirect left from an earlier rename.
  await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
  const redirect = await tx.redirect.findUnique({ where: { fromPath } });
  if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Content slug changed in Admin" } });
  else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Content slug changed in Admin" } });
}

async function recordContentChange(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  entryId: string,
  before: EditableContent,
  after: EditableContent,
  ip: string | null,
  action: string,
  note: string,
  eventType: "content.updated" | "content.published" = "content.updated",
) {
  await saveRevision(tx, { ...after, id: entryId }, actor, note);
  await audit({ actorId: actor.id, organizationId: actor.organizationId, action, resourceType: "content", resourceId: entryId, before, after, ip }, tx);
  await emitEvent("content", entryId, eventType, { contentEntryId: entryId, by: actor.email }, tx);
}

export type ContentReviewDecision = "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH";

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid content version", "INVALID_VERSION");
  return parsed;
}

export async function pairContentTranslations(
  actor: SessionUser,
  englishContentEntryId: string,
  englishExpectedUpdatedAtText: string,
  arabicContentEntryId: string,
  arabicExpectedUpdatedAtText: string,
  ip: string | null,
) {
  if (englishContentEntryId === arabicContentEntryId) throw new HttpError(422, "Choose two different content entries.", "INVALID_TRANSLATION_PAIR");
  const expectedById = new Map([
    [englishContentEntryId, parseVersion(englishExpectedUpdatedAtText)],
    [arabicContentEntryId, parseVersion(arabicExpectedUpdatedAtText)],
  ]);
  try {
    return await db.$transaction(async (tx) => {
      const entries = await tx.contentEntry.findMany({
        where: { id: { in: [englishContentEntryId, arabicContentEntryId] } },
        select: { id: true, contentType: true, locale: true, translationGroupId: true, updatedAt: true },
      });
      const english = entries.find((entry) => entry.id === englishContentEntryId);
      const arabic = entries.find((entry) => entry.id === arabicContentEntryId);
      if (!english || !arabic) throw new HttpError(404, "One or both content entries were not found.", "NOT_FOUND");
      ensureStandaloneReportIsManagedSeparately(english.contentType);
      ensureStandaloneReportIsManagedSeparately(arabic.contentType);
      if (english.locale !== "en" || arabic.locale !== "ar" || english.contentType !== arabic.contentType) {
        throw new HttpError(422, "Pair one English and one Arabic entry of the same content type.", "INVALID_TRANSLATION_PAIR");
      }
      for (const entry of [english, arabic]) {
        if (entry.updatedAt.getTime() !== expectedById.get(entry.id)?.getTime()) {
          throw new HttpError(409, "A content entry changed since it was loaded. Refresh before pairing.", "VERSION_CONFLICT");
        }
        if (entry.translationGroupId) throw new HttpError(409, "An entry is already paired. Unlink its current translation first.", "TRANSLATION_ALREADY_PAIRED");
      }
      const group = await tx.contentTranslationGroup.create({ data: {} });
      const before = { translationGroupId: null };
      const after = { translationGroupId: group.id };
      for (const entry of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
        const changed = await tx.contentEntry.updateMany({
          where: { id: entry.id, updatedAt: expectedById.get(entry.id), translationGroupId: null },
          data: { translationGroupId: group.id, updatedAt: new Date() },
        });
        if (changed.count !== 1) throw new HttpError(409, "A content entry changed while pairing. Refresh and retry.", "VERSION_CONFLICT");
        await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "content.translation_pair", resourceType: "content", resourceId: entry.id, before, after, ip }, tx);
        await emitEvent("content", entry.id, "content.updated", { contentEntryId: entry.id, by: actor.email, change: "translation_pair" }, tx);
      }
      return { ok: true as const, translationGroupId: group.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw new HttpError(409, "A content entry was paired concurrently. Refresh and retry.", "TRANSLATION_PAIR_CONFLICT");
    }
    throw error;
  }
}

export async function unlinkContentTranslation(
  actor: SessionUser,
  contentEntryId: string,
  expectedUpdatedAtText: string,
  peerExpectedUpdatedAtText: string,
  ip: string | null,
) {
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  const peerExpectedUpdatedAt = parseVersion(peerExpectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const entry = await tx.contentEntry.findUnique({ where: { id: contentEntryId }, select: { id: true, contentType: true, translationGroupId: true, updatedAt: true } });
    if (!entry) throw new HttpError(404, "Content entry not found.", "NOT_FOUND");
    ensureStandaloneReportIsManagedSeparately(entry.contentType);
    if (!entry.translationGroupId) throw new HttpError(409, "This entry has no linked translation.", "TRANSLATION_NOT_PAIRED");
    const group = await tx.contentTranslationGroup.findUnique({
      where: { id: entry.translationGroupId },
      include: { entries: { select: { id: true, translationGroupId: true, updatedAt: true } } },
    });
    if (!group || group.entries.length !== 2) throw new HttpError(409, "The translation pair is incomplete and needs an administrator to repair it.", "INVALID_TRANSLATION_GROUP");
    const peer = group.entries.find((candidate) => candidate.id !== entry.id);
    if (!peer) throw new HttpError(409, "The translation pair is incomplete and needs an administrator to repair it.", "INVALID_TRANSLATION_GROUP");
    const expectedById = new Map([[entry.id, expectedUpdatedAt], [peer.id, peerExpectedUpdatedAt]]);
    for (const member of group.entries) {
      if (member.translationGroupId !== group.id || member.updatedAt.getTime() !== expectedById.get(member.id)?.getTime()) {
        throw new HttpError(409, "The translation pair changed since it was loaded. Refresh before unlinking.", "VERSION_CONFLICT");
      }
    }
    for (const member of [...group.entries].sort((a, b) => a.id.localeCompare(b.id))) {
      const changed = await tx.contentEntry.updateMany({
        where: { id: member.id, updatedAt: expectedById.get(member.id), translationGroupId: group.id },
        data: { translationGroupId: null, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "The translation pair changed while unlinking. Refresh and retry.", "VERSION_CONFLICT");
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: "content.translation_unlink",
        resourceType: "content", resourceId: member.id,
        before: { translationGroupId: group.id }, after: { translationGroupId: null }, ip,
      }, tx);
      await emitEvent("content", member.id, "content.updated", { contentEntryId: member.id, by: actor.email, change: "translation_unlink" }, tx);
    }
    await tx.contentTranslationGroup.delete({ where: { id: group.id } });
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewContentEntry(
  actor: SessionUser,
  contentEntryId: string,
  expectedUpdatedAtText: string,
  decision: ContentReviewDecision,
  note: string,
  ip: string | null,
) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or admin can review or publish editorial content.", "CONTENT_REVIEW_FORBIDDEN");
  }
  const expectedUpdatedAt = new Date(expectedUpdatedAtText);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid content version", "INVALID_VERSION");

  return db.$transaction(async (tx) => {
    const entry = await tx.contentEntry.findUnique({ where: { id: contentEntryId } });
    if (!entry) throw new HttpError(404, "Content entry not found", "NOT_FOUND");
    ensureStandaloneReportIsManagedSeparately(entry.contentType);
    if (entry.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This content changed since it was loaded. Refresh and review the latest version.", "VERSION_CONFLICT");
    const before: EditableContent = {
      contentType: entry.contentType, locale: entry.locale, slug: entry.slug, title: entry.title,
      excerpt: entry.excerpt, body: entry.body, category: entry.category, status: entry.status,
      bodyJson: entry.bodyJson,
      coverMediaId: entry.coverMediaId,
      reviewWorkflowState: entry.reviewWorkflowState, publishedAt: entry.publishedAt,
    };
    const latest = await tx.contentRevision.findFirst({ where: { contentEntryId: entry.id }, orderBy: { version: "desc" } });
    if (decision === "APPROVE" || decision === "CHANGES_REQUESTED") {
      if (entry.status !== "IN_REVIEW" || entry.reviewWorkflowState !== "PENDING_REVIEW") {
        throw new HttpError(409, "Only a pending-review entry can receive a review decision.", "REVIEW_STATE_CONFLICT");
      }
      if (latest?.editedBy === actor.id) throw new HttpError(409, "The most recent editor cannot review their own revision.", "SELF_REVIEW_BLOCKED");
      if (decision === "CHANGES_REQUESTED" && !note.trim()) throw new HttpError(422, "A reason is required when requesting changes.", "REVIEW_NOTE_REQUIRED");
    }

    let status = entry.status;
    let reviewWorkflowState = entry.reviewWorkflowState;
    let publishedAt = entry.publishedAt;
    let action: string;
    let revisionNote = note.trim();
    let eventType: "content.updated" | "content.published" = "content.updated";
    if (decision === "APPROVE") {
      reviewWorkflowState = "APPROVED";
      action = "content.approve";
      revisionNote ||= "Approved for publication";
    } else if (decision === "CHANGES_REQUESTED") {
      status = "DRAFT";
      reviewWorkflowState = "CHANGES_REQUESTED";
      publishedAt = null;
      action = "content.changes_requested";
      revisionNote = note.trim();
    } else {
      if (entry.status !== "IN_REVIEW" || entry.reviewWorkflowState !== "APPROVED") {
        throw new HttpError(409, "Content must be approved before publication.", "APPROVAL_REQUIRED");
      }
      if (entry.contentType === "LEGAL") throw new HttpError(424, "Legal publishing remains blocked until approved legal text and sources are available.", "BLOCKED_EXTERNAL");
      if (!entry.title.trim() || (!entry.body.trim() && !readContentBlocks(entry.bodyJson))) throw new HttpError(422, "A title and body are required before publication.", "PUBLICATION_VALIDATION");
      status = "PUBLISHED";
      publishedAt = new Date();
      action = "content.publish";
      revisionNote ||= "Published approved revision";
      eventType = "content.published";
    }

    const after: EditableContent = { ...before, status, reviewWorkflowState, publishedAt };
    const changed = await tx.contentEntry.updateMany({
      where: { id: entry.id, updatedAt: expectedUpdatedAt },
      data: { status, reviewWorkflowState, publishedAt, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This content changed during review. Refresh and retry.", "VERSION_CONFLICT");
    await recordContentChange(tx, actor, entry.id, before, after, ip, action, revisionNote, eventType);
    const updated = await tx.contentEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { updatedAt: true } });
    return { ok: true as const, status, reviewWorkflowState, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Reversible editorial retirement; this removes public visibility but never deletes content or revisions. */
export async function retireContentEntry(actor: SessionUser, contentEntryId: string, expectedUpdatedAtText: string, retire: boolean, ip: string | null) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN" || role === "CONTENT_EDITOR")) {
    throw new HttpError(403, "You cannot manage editorial content.", "CONTENT_EDIT_FORBIDDEN");
  }
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const entry = await tx.contentEntry.findUnique({ where: { id: contentEntryId } });
    if (!entry) throw new HttpError(404, "Content entry not found.", "NOT_FOUND");
    ensureStandaloneReportIsManagedSeparately(entry.contentType);
    if (entry.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This content changed since it was loaded. Refresh before changing its archive state.", "VERSION_CONFLICT");
    if (retire ? entry.status === "RETIRED" : entry.status !== "RETIRED") {
      throw new HttpError(409, retire ? "This entry is already retired." : "Only a retired entry can be restored as a draft.", "CONTENT_ARCHIVE_STATE");
    }
    const before: EditableContent = {
      contentType: entry.contentType, locale: entry.locale, slug: entry.slug, title: entry.title,
      excerpt: entry.excerpt, body: entry.body, bodyJson: entry.bodyJson, category: entry.category,
      coverMediaId: entry.coverMediaId, status: entry.status, reviewWorkflowState: entry.reviewWorkflowState, publishedAt: entry.publishedAt,
    };
    const after: EditableContent = {
      ...before,
      status: retire ? "RETIRED" : "DRAFT",
      reviewWorkflowState: "NONE",
      publishedAt: null,
    };
    const changed = await tx.contentEntry.updateMany({
      where: { id: entry.id, updatedAt: expectedUpdatedAt },
      data: { status: after.status, reviewWorkflowState: after.reviewWorkflowState, publishedAt: null, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This content changed during the archive action. Refresh and retry.", "VERSION_CONFLICT");
    await recordContentChange(tx, actor, entry.id, before, after, ip, retire ? "content.retire" : "content.restore_draft", retire ? "Retired content from public use" : "Restored retired content as a draft");
    const updated = await tx.contentEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { updatedAt: true } });
    return { ok: true as const, status: after.status, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createContentDraft(actor: SessionUser, input: NewContentDraftInput, ip: string | null) {
  ensureSlugAndTitle(input.slug, input.title);
  try {
    return await db.$transaction(async (tx) => {
      const coverMediaId = await ensurePublicImage(tx, input.coverMediaId);
      const structured = serializeContentBlocks(input.blocks);
      await ensurePublicBlockImages(tx, structured.blocks);
      if (!input.body.trim() && !structured.blocks) throw new HttpError(422, "Enter Markdown or add at least one valid content block.", "CONTENT_BODY_REQUIRED");
      const entry = await tx.contentEntry.create({
        data: {
          contentType: input.contentType,
          locale: input.locale,
          slug: input.slug.trim().toLowerCase(),
          title: input.title.trim(),
          excerpt: input.excerpt?.trim() || null,
          body: input.body,
          bodyJson: structured.json,
          category: input.category?.trim() || null,
          coverMediaId,
          status: "DRAFT",
          reviewWorkflowState: "NONE",
          authorId: actor.id,
        },
      });
      const state: EditableContent = {
        contentType: entry.contentType, locale: entry.locale, slug: entry.slug, title: entry.title,
        excerpt: entry.excerpt, body: entry.body, category: entry.category, status: entry.status,
        bodyJson: entry.bodyJson,
        coverMediaId: entry.coverMediaId,
        reviewWorkflowState: entry.reviewWorkflowState, publishedAt: entry.publishedAt,
      };
      await recordContentChange(tx, actor, entry.id, state, state, ip, "content.create_draft", "Created draft");
      return { id: entry.id, updatedAt: entry.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "That content slug is already in use.", "SLUG_CONFLICT");
    throw error;
  }
}

export async function updateContentDraft(actor: SessionUser, input: ContentDraftInput, ip: string | null) {
  ensureSlugAndTitle(input.slug, input.title);
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid content version", "INVALID_VERSION");

  try {
    return await db.$transaction(async (tx) => {
      const entry = await tx.contentEntry.findUnique({ where: { id: input.contentEntryId } });
      if (!entry) throw new HttpError(404, "Content entry not found", "NOT_FOUND");
      ensureStandaloneReportIsManagedSeparately(entry.contentType);
      if (entry.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This content changed since it was loaded. Refresh and review the latest version.", "VERSION_CONFLICT");
      const before: EditableContent = {
        contentType: entry.contentType, locale: entry.locale, slug: entry.slug, title: entry.title,
        excerpt: entry.excerpt, body: entry.body, category: entry.category, status: entry.status,
        bodyJson: entry.bodyJson,
        coverMediaId: entry.coverMediaId,
        reviewWorkflowState: entry.reviewWorkflowState, publishedAt: entry.publishedAt,
      };
      const editedPublishedEntry = entry.status === "PUBLISHED";
      const status = editedPublishedEntry ? "IN_REVIEW" : input.submitForReview ? "IN_REVIEW" : "DRAFT";
      const reviewWorkflowState = input.submitForReview || editedPublishedEntry ? "PENDING_REVIEW" : "NONE";
      const publishedAt = editedPublishedEntry ? null : entry.publishedAt;
      const coverMediaId = input.coverMediaId === undefined ? entry.coverMediaId : await ensurePublicImage(tx, input.coverMediaId);
      const structured = input.blocks === undefined
        ? { json: entry.bodyJson, blocks: readContentBlocks(entry.bodyJson) }
        : serializeContentBlocks(input.blocks);
      await ensurePublicBlockImages(tx, structured.blocks);
      if (!input.body.trim() && !structured.blocks) throw new HttpError(422, "Enter Markdown or add at least one valid content block.", "CONTENT_BODY_REQUIRED");
      const after: EditableContent = {
        contentType: entry.contentType,
        locale: entry.locale,
        slug: input.slug.trim().toLowerCase(),
        title: input.title.trim(),
        excerpt: input.excerpt?.trim() || null,
        body: input.body,
        bodyJson: structured.json,
        category: input.category?.trim() || null,
        coverMediaId,
        status,
        reviewWorkflowState,
        publishedAt,
      };
      const changed = await tx.contentEntry.updateMany({
        where: { id: entry.id, updatedAt: expectedUpdatedAt },
        data: {
          slug: after.slug, title: after.title, excerpt: after.excerpt, body: after.body, bodyJson: after.bodyJson, category: after.category, coverMediaId,
          status, reviewWorkflowState, publishedAt, updatedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new HttpError(409, "This content changed during the save. Refresh and review the latest version.", "VERSION_CONFLICT");
      await preserveSlug(tx, before, after);
      await recordContentChange(tx, actor, entry.id, before, after, ip, "content.update_draft", input.submitForReview ? "Submitted for review" : editedPublishedEntry ? "Published content returned to review" : "Saved draft");
      const updated = await tx.contentEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString(), status, reviewWorkflowState };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "That content slug is already in use.", "SLUG_CONFLICT");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new HttpError(409, "This content changed during the save. Refresh and review the latest version.", "VERSION_CONFLICT");
    throw error;
  }
}

export async function rollbackContentDraft(actor: SessionUser, contentEntryId: string, revisionId: string, expectedUpdatedAtText: string, ip: string | null) {
  const expectedUpdatedAt = new Date(expectedUpdatedAtText);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid content version", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const entry = await tx.contentEntry.findUnique({ where: { id: contentEntryId } });
    const revision = await tx.contentRevision.findFirst({ where: { id: revisionId, contentEntryId } });
    if (!entry || !revision) throw new HttpError(404, "Content revision not found", "NOT_FOUND");
    ensureStandaloneReportIsManagedSeparately(entry.contentType);
    if (entry.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This content changed since it was loaded. Refresh before restoring a version.", "VERSION_CONFLICT");
    let restored: Partial<EditableContent>;
    try { restored = JSON.parse(revision.snapshotJson) as Partial<EditableContent>; }
    catch { throw new HttpError(409, "This stored revision is invalid and cannot be restored.", "INVALID_REVISION"); }
    if (typeof restored.title !== "string" || typeof restored.slug !== "string" || typeof restored.body !== "string") {
      throw new HttpError(409, "This stored revision is incomplete and cannot be restored.", "INVALID_REVISION");
    }
    const structured = blocksFromSnapshot(restored.bodyJson);
    await ensurePublicBlockImages(tx, structured.blocks);
    const before: EditableContent = {
      contentType: entry.contentType, locale: entry.locale, slug: entry.slug, title: entry.title,
      excerpt: entry.excerpt, body: entry.body, category: entry.category, status: entry.status,
      bodyJson: entry.bodyJson,
      coverMediaId: entry.coverMediaId,
      reviewWorkflowState: entry.reviewWorkflowState, publishedAt: entry.publishedAt,
    };
    const after: EditableContent = {
      contentType: entry.contentType, locale: entry.locale, slug: restored.slug.trim().toLowerCase(), title: restored.title.trim(),
      excerpt: restored.excerpt ?? null, body: restored.body, category: restored.category ?? null,
      bodyJson: structured.json,
      coverMediaId: await ensurePublicImage(tx, restored.coverMediaId ?? null),
      status: "DRAFT", reviewWorkflowState: "NONE", publishedAt: null,
    };
    ensureSlugAndTitle(after.slug, after.title);
    const changed = await tx.contentEntry.updateMany({
      where: { id: entry.id, updatedAt: expectedUpdatedAt },
      data: { slug: after.slug, title: after.title, excerpt: after.excerpt, body: after.body, bodyJson: after.bodyJson, category: after.category, coverMediaId: after.coverMediaId, status: "DRAFT", reviewWorkflowState: "NONE", publishedAt: null, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This content changed during restore. Refresh before trying again.", "VERSION_CONFLICT");
    await preserveSlug(tx, before, after);
    await recordContentChange(tx, actor, entry.id, before, after, ip, "content.rollback", `Restored revision ${revision.version}`);
    const updated = await tx.contentEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { updatedAt: true } });
    return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

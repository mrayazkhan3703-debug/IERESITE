import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { isRagSourceRetrievable } from "@/server/rag/policy";
import { hashRagContent } from "@/server/rag/provenance";

export type RagSourceInput = {
  title: string;
  sourceType: "INTERNAL_DOC" | "OFFICIAL" | "NEWS" | "REPORT" | "GUIDE";
  canonicalUrl?: string | null;
  publisher?: string | null;
  version?: string | null;
  trustTier: "INTERNAL" | "OFFICIAL" | "SECONDARY" | "UNVERIFIED";
  verifiedAt: string;
  freshnessReviewDueAt: string;
  isActive: boolean;
};

export type RagDocumentInput = {
  sourceId: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  content: string;
  changeNote?: string;
};

function requireEditor(actor: SessionUser) {
  if (!actor.roles.some((role) => ["OWNER", "ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new HttpError(403, "You cannot manage the AI knowledge base.", "RAG_EDIT_FORBIDDEN");
  }
}

function requireReviewer(actor: SessionUser) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or admin can approve AI knowledge sources and documents.", "RAG_REVIEW_FORBIDDEN");
  }
}

function parseDate(value: string, label: string): Date {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new HttpError(422, `Enter a valid ${label}.`, "RAG_VALIDATION");
  return result;
}

function parseVersion(value: string) {
  const parsed = parseDate(value, "record version");
  return parsed;
}

function normalizeReviewNote(note: string) {
  const normalized = note.trim();
  if (!normalized || normalized.length > 500) {
    throw new HttpError(422, "Add a review note of 1 to 500 characters.", "RAG_REVIEW_NOTE_REQUIRED");
  }
  return normalized;
}

function normalizeSource(input: RagSourceInput) {
  const title = input.title.trim();
  if (!title || title.length > 240) throw new HttpError(422, "Enter a source title up to 240 characters.", "RAG_VALIDATION");
  const canonicalUrl = input.canonicalUrl?.trim() || null;
  if (canonicalUrl) {
    let url: URL;
    try { url = new URL(canonicalUrl); } catch { throw new HttpError(422, "Source URL must be a valid HTTPS URL.", "RAG_SOURCE_URL"); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new HttpError(422, "Source URL must be HTTPS without embedded credentials.", "RAG_SOURCE_URL");
    }
  }
  if (input.trustTier === "OFFICIAL" && !canonicalUrl) {
    throw new HttpError(422, "Official sources need their canonical HTTPS URL.", "RAG_SOURCE_URL");
  }
  const verifiedAt = parseDate(input.verifiedAt, "verification date");
  const freshnessReviewDueAt = parseDate(input.freshnessReviewDueAt, "freshness review due date");
  if (verifiedAt.getTime() > Date.now() || freshnessReviewDueAt <= verifiedAt) {
    throw new HttpError(422, "Verification must be in the past and the review due date must be later.", "RAG_SOURCE_FRESHNESS");
  }
  return {
    title,
    sourceType: input.sourceType,
    canonicalUrl,
    publisher: input.publisher?.trim().slice(0, 240) || null,
    version: input.version?.trim().slice(0, 120) || null,
    trustTier: input.trustTier,
    verifiedAt,
    freshnessReviewDueAt,
    isActive: input.isActive,
  };
}

function normalizeDocument(input: RagDocumentInput) {
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  const content = input.content.trim();
  if (!title || title.length > 300 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) {
    throw new HttpError(422, "Enter a title and URL-safe knowledge slug.", "RAG_DOCUMENT_VALIDATION");
  }
  if (content.length < 41 || content.length > 50_000) {
    throw new HttpError(422, "Knowledge text must be between 41 and 50,000 characters.", "RAG_DOCUMENT_VALIDATION");
  }
  return { sourceId: input.sourceId, title, slug, locale: input.locale, content, contentHash: hashRagContent(content) };
}

function sourceSnapshot(source: {
  title: string; sourceType: string; canonicalUrl: string | null; publisher: string | null; version: string | null;
  trustTier: string; verifiedAt: Date | null; freshnessReviewDueAt: Date | null; isActive: boolean; isApproved: boolean;
  createdById: string | null; updatedById: string | null; approvedById: string | null; approvedAt: Date | null;
}) {
  return {
    ...source,
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    freshnessReviewDueAt: source.freshnessReviewDueAt?.toISOString() ?? null,
    approvedAt: source.approvedAt?.toISOString() ?? null,
  };
}

function documentSnapshot(document: {
  sourceId: string; title: string; slug: string; locale: string; content: string; contentHash: string;
  status: string; version: number; createdById: string | null; updatedById: string | null;
  approvedById: string | null; approvedAt: Date | null;
}) {
  return { ...document, approvedAt: document.approvedAt?.toISOString() ?? null };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "The knowledge record changed during save. Refresh and retry.", "VERSION_CONFLICT");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "That knowledge slug is already in use.", "SLUG_CONFLICT");
  }
  throw error;
}

async function requireApprovedSource(tx: Prisma.TransactionClient, sourceId: string) {
  const source = await tx.ragSource.findUnique({ where: { id: sourceId } });
  if (!source || !isRagSourceRetrievable(source)) {
    throw new HttpError(409, "Choose an active source that has current independent review approval first.", "RAG_SOURCE_NOT_APPROVED");
  }
  return source;
}

export async function createRagSource(actor: SessionUser, input: RagSourceInput, ip: string | null) {
  requireEditor(actor);
  const values = normalizeSource(input);
  return db.$transaction(async (tx) => {
    const source = await tx.ragSource.create({
      data: { ...values, isApproved: false, createdById: actor.id, updatedById: actor.id },
    });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "rag_source.create_draft", resourceType: "rag_source", resourceId: source.id, before: null, after: sourceSnapshot(source), ip }, tx);
    await emitEvent("rag_source", source.id, "rag.source.updated", { ragSourceId: source.id, by: actor.id }, tx);
    return { id: source.id, isApproved: false, updatedAt: source.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function updateRagSource(
  actor: SessionUser,
  sourceId: string,
  expectedUpdatedAtText: string,
  input: RagSourceInput,
  ip: string | null,
) {
  requireEditor(actor);
  const values = normalizeSource(input);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const source = await tx.ragSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new HttpError(404, "Knowledge source not found.", "NOT_FOUND");
    if (source.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This source changed since it was loaded.", "VERSION_CONFLICT");
    const updated = await tx.ragSource.update({
      where: { id: source.id },
      data: { ...values, isApproved: false, updatedById: actor.id, approvedById: null, approvedAt: null },
    });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "rag_source.update_revoke_approval", resourceType: "rag_source", resourceId: source.id, before: sourceSnapshot(source), after: sourceSnapshot(updated), ip }, tx);
    await emitEvent("rag_source", source.id, "rag.source.updated", { ragSourceId: source.id, by: actor.id }, tx);
    return { isApproved: updated.isApproved, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function reviewRagSource(
  actor: SessionUser,
  sourceId: string,
  expectedUpdatedAtText: string,
  decision: "APPROVE" | "REVOKE",
  note: string,
  ip: string | null,
) {
  requireReviewer(actor);
  const reviewNote = normalizeReviewNote(note);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const source = await tx.ragSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new HttpError(404, "Knowledge source not found.", "NOT_FOUND");
    if (source.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This source changed since it was loaded.", "VERSION_CONFLICT");
    if (decision === "APPROVE") {
      if ((source.updatedById ?? source.createdById) === actor.id) throw new HttpError(409, "A different owner/admin must review this source.", "RAG_DISTINCT_REVIEWER_REQUIRED");
      if (!isRagSourceRetrievable({ ...source, isApproved: true, approvedById: actor.id, approvedAt: new Date() })) {
        throw new HttpError(422, "Source must be active, verified, trust-tiered, and within its review window before approval.", "RAG_SOURCE_PROVENANCE_REQUIRED");
      }
    }
    const updated = await tx.ragSource.update({
      where: { id: source.id },
      data: {
        isApproved: decision === "APPROVE",
        approvedById: decision === "APPROVE" ? actor.id : null,
        approvedAt: decision === "APPROVE" ? new Date() : null,
        updatedById: actor.id,
      },
    });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: decision === "APPROVE" ? "rag_source.approve" : "rag_source.revoke", resourceType: "rag_source", resourceId: source.id, before: sourceSnapshot(source), after: { ...sourceSnapshot(updated), reviewNote }, ip }, tx);
    await emitEvent("rag_source", source.id, "rag.source.updated", { ragSourceId: source.id, by: actor.id }, tx);
    return { isApproved: updated.isApproved, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function createRagDocument(actor: SessionUser, input: RagDocumentInput, ip: string | null) {
  requireEditor(actor);
  const values = normalizeDocument(input);
  return db.$transaction(async (tx) => {
    await requireApprovedSource(tx, values.sourceId);
    const document = await tx.ragDocument.create({
      data: { ...values, status: "DRAFT", version: 1, createdById: actor.id, updatedById: actor.id },
    });
    const after = documentSnapshot(document);
    await tx.ragDocumentRevision.create({
      data: { documentId: document.id, version: document.version, snapshotJson: JSON.stringify(after), editedBy: actor.id, changeNote: input.changeNote?.slice(0, 300) ?? "Created draft" },
    });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "rag_document.create_draft", resourceType: "rag_document", resourceId: document.id, before: null, after, ip }, tx);
    await emitEvent("rag_document", document.id, "rag.document.updated", { ragDocumentId: document.id, by: actor.id }, tx);
    return { id: document.id, status: document.status, version: document.version, updatedAt: document.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function updateRagDocument(
  actor: SessionUser,
  documentId: string,
  expectedUpdatedAtText: string,
  input: RagDocumentInput,
  ip: string | null,
) {
  requireEditor(actor);
  const values = normalizeDocument(input);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const document = await tx.ragDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new HttpError(404, "Knowledge document not found.", "NOT_FOUND");
    if (document.status === "RETIRED") throw new HttpError(409, "Restore this document as a draft before editing.", "RAG_DOCUMENT_RETIRED");
    if (document.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This document changed since it was loaded.", "VERSION_CONFLICT");
    await requireApprovedSource(tx, values.sourceId);
    const before = documentSnapshot(document);
    const updated = await tx.ragDocument.update({
      where: { id: document.id },
      data: {
        ...values,
        status: "DRAFT",
        version: { increment: 1 },
        updatedById: actor.id,
        approvedById: null,
        approvedAt: null,
      },
    });
    await tx.ragChunk.deleteMany({ where: { documentId: document.id } });
    const after = documentSnapshot(updated);
    await tx.ragDocumentRevision.create({
      data: { documentId: document.id, version: updated.version, snapshotJson: JSON.stringify(after), editedBy: actor.id, changeNote: input.changeNote?.slice(0, 300) ?? "Saved draft; review approval cleared" },
    });
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "rag_document.update_draft", resourceType: "rag_document", resourceId: document.id, before, after, ip }, tx);
    await emitEvent("rag_document", document.id, "rag.document.updated", { ragDocumentId: document.id, by: actor.id }, tx);
    return { status: updated.status, version: updated.version, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function reviewRagDocument(
  actor: SessionUser,
  documentId: string,
  expectedUpdatedAtText: string,
  decision: "APPROVE" | "CHANGES_REQUESTED" | "RETIRE" | "RESTORE",
  note: string,
  ip: string | null,
) {
  requireReviewer(actor);
  const reviewNote = normalizeReviewNote(note);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const document = await tx.ragDocument.findUnique({ where: { id: documentId }, include: { source: true } });
    if (!document) throw new HttpError(404, "Knowledge document not found.", "NOT_FOUND");
    if (document.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This document changed since it was loaded.", "VERSION_CONFLICT");
    if (decision === "RESTORE" && document.status !== "RETIRED") throw new HttpError(409, "Only a retired document can be restored.", "RAG_DOCUMENT_NOT_RETIRED");
    if (decision === "APPROVE") {
      if ((document.updatedById ?? document.createdById) === actor.id) throw new HttpError(409, "A different owner/admin must review this document.", "RAG_DISTINCT_REVIEWER_REQUIRED");
      await requireApprovedSource(tx, document.sourceId);
    }
    const status = decision === "APPROVE" ? "ACTIVE" : decision === "RETIRE" ? "RETIRED" : "DRAFT";
    const updated = await tx.ragDocument.update({
      where: { id: document.id },
      data: {
        status,
        updatedById: actor.id,
        approvedById: decision === "APPROVE" ? actor.id : null,
        approvedAt: decision === "APPROVE" ? new Date() : null,
      },
    });
    const before = documentSnapshot(document);
    const after = documentSnapshot(updated);
    await audit({ actorId: actor.id, organizationId: actor.organizationId, action: `rag_document.${decision.toLowerCase()}`, resourceType: "rag_document", resourceId: document.id, before, after: { ...after, reviewNote }, ip }, tx);
    await emitEvent(
      "rag_document",
      document.id,
      decision === "APPROVE" ? "rag.document.published" : "rag.document.updated",
      { ragDocumentId: document.id, documentVersion: updated.version, contentHash: updated.contentHash, by: actor.id },
      tx,
    );
    return { status, approvedById: updated.approvedById, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

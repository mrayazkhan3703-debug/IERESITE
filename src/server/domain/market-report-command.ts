import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";

export interface MarketReportInput {
  slug: string;
  title: string;
  summary?: string | null;
  periodLabel?: string | null;
  methodology?: string | null;
  dataSourceName?: string | null;
  dataSourceUrl?: string | null;
  retrievedAt?: string | null;
  body: string;
  coverMediaId?: string | null;
  fileMediaId?: string | null;
  gated: boolean;
  isIllustrative: boolean;
  submitForReview?: boolean;
}

interface EditableReport {
  slug: string;
  title: string;
  summary: string | null;
  periodLabel: string | null;
  methodology: string | null;
  dataSourceName: string | null;
  dataSourceUrl: string | null;
  retrievedAt: Date | null;
  body: string;
  coverMediaId: string | null;
  fileMediaId: string | null;
  status: string;
  reviewWorkflowState: string;
  approvedBy: string | null;
  isIllustrative: boolean;
  gated: boolean;
  publishedAt: Date | null;
}

function requireEditor(actor: SessionUser) {
  if (!actor.roles.some((role) => ["OWNER", "ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new HttpError(403, "You cannot manage market reports.", "MARKET_REPORT_EDIT_FORBIDDEN");
  }
}

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid report version.", "INVALID_VERSION");
  return parsed;
}

function cleanNullable(value: string | null | undefined) {
  return value?.trim() || null;
}

function validateInput(input: MarketReportInput) {
  const slug = input.slug.trim().toLowerCase();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180 || !title || title.length > 300) {
    throw new HttpError(422, "Enter a title and URL-safe report slug.", "MARKET_REPORT_VALIDATION");
  }
  if (body.length > 50_000) throw new HttpError(422, "Report body exceeds the allowed size.", "MARKET_REPORT_VALIDATION");
  const dataSourceUrl = cleanNullable(input.dataSourceUrl);
  if (dataSourceUrl) {
    let parsed: URL;
    try { parsed = new URL(dataSourceUrl); } catch { throw new HttpError(422, "Source URL must be a valid HTTP(S) URL.", "MARKET_REPORT_SOURCE_URL"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new HttpError(422, "Source URL must be a public HTTP(S) URL without embedded credentials.", "MARKET_REPORT_SOURCE_URL");
    }
  }
  const retrievedAt = input.retrievedAt ? new Date(input.retrievedAt) : null;
  if (input.retrievedAt && (!retrievedAt || !Number.isFinite(retrievedAt.getTime()))) {
    throw new HttpError(422, "Choose a valid source retrieval time.", "MARKET_REPORT_RETRIEVAL_TIME");
  }
  if (retrievedAt && retrievedAt.getTime() > Date.now()) {
    throw new HttpError(422, "Source retrieval time cannot be in the future.", "MARKET_REPORT_RETRIEVAL_TIME");
  }
  return {
    slug,
    title,
    summary: cleanNullable(input.summary)?.slice(0, 1000) ?? null,
    periodLabel: cleanNullable(input.periodLabel)?.slice(0, 100) ?? null,
    methodology: cleanNullable(input.methodology)?.slice(0, 5000) ?? null,
    dataSourceName: cleanNullable(input.dataSourceName)?.slice(0, 240) ?? null,
    dataSourceUrl,
    retrievedAt,
    body,
    coverMediaId: cleanNullable(input.coverMediaId),
    fileMediaId: cleanNullable(input.fileMediaId),
    gated: input.gated,
    isIllustrative: input.isIllustrative,
  };
}

function snapshot(report: EditableReport) {
  return JSON.stringify({
    ...report,
    retrievedAt: report.retrievedAt?.toISOString() ?? null,
    publishedAt: report.publishedAt?.toISOString() ?? null,
  });
}

function state(report: {
  slug: string; title: string; summary: string | null; periodLabel: string | null; methodology: string | null;
  dataSourceName: string | null; dataSourceUrl: string | null; retrievedAt: Date | null; body: string;
  coverMediaId: string | null; fileMediaId: string | null; status: string; reviewWorkflowState: string;
  approvedBy: string | null; isIllustrative: boolean; gated: boolean; publishedAt: Date | null;
}): EditableReport {
  return {
    slug: report.slug, title: report.title, summary: report.summary, periodLabel: report.periodLabel,
    methodology: report.methodology, dataSourceName: report.dataSourceName, dataSourceUrl: report.dataSourceUrl,
    retrievedAt: report.retrievedAt, body: report.body, coverMediaId: report.coverMediaId,
    fileMediaId: report.fileMediaId, status: report.status, reviewWorkflowState: report.reviewWorkflowState,
    approvedBy: report.approvedBy, isIllustrative: report.isIllustrative, gated: report.gated,
    publishedAt: report.publishedAt,
  };
}

async function ensureMedia(tx: Prisma.TransactionClient, id: string | null, kind: "IMAGE" | "DOCUMENT") {
  if (!id) return null;
  const asset = await tx.mediaAsset.findFirst({ where: { id, isPrivate: false, kind }, select: { id: true } });
  if (!asset) throw new HttpError(422, `Choose an available public ${kind.toLowerCase()} from the Media Library.`, "MEDIA_NOT_AVAILABLE");
  return asset.id;
}

async function recordChange(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  id: string,
  before: EditableReport | null,
  after: EditableReport,
  ip: string | null,
  action: string,
  note: string,
  eventType: "market-report.updated" | "market-report.published" = "market-report.updated",
) {
  const current = await tx.marketReportRevision.aggregate({ where: { marketReportId: id }, _max: { version: true } });
  await tx.marketReportRevision.create({
    data: { marketReportId: id, version: (current._max.version ?? 0) + 1, snapshotJson: snapshot(after), editedBy: actor.id, changeNote: note.slice(0, 300) },
  });
  await audit({ actorId: actor.id, organizationId: actor.organizationId, action, resourceType: "market_report", resourceId: id, before, after, ip }, tx);
  await emitEvent("market_report", id, eventType, { marketReportId: id, by: actor.email }, tx);
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "The report changed during save. Refresh and retry.", "VERSION_CONFLICT");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "That report slug is already in use.", "SLUG_CONFLICT");
  }
  throw error;
}

async function preserveSlug(tx: Prisma.TransactionClient, before: EditableReport, after: EditableReport) {
  if (before.slug === after.slug) return;
  const fromPath = `/market/reports/${before.slug}`;
  const toPath = `/market/reports/${after.slug}`;
  await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
  const existing = await tx.redirect.findUnique({ where: { fromPath } });
  if (existing) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Market report slug changed in Admin" } });
  else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Market report slug changed in Admin" } });
}

export async function createMarketReport(actor: SessionUser, input: MarketReportInput, ip: string | null) {
  requireEditor(actor);
  const values = validateInput(input);
  return db.$transaction(async (tx) => {
    const coverMediaId = await ensureMedia(tx, values.coverMediaId, "IMAGE");
    const fileMediaId = await ensureMedia(tx, values.fileMediaId, "DOCUMENT");
    const status = input.submitForReview ? "IN_REVIEW" : "DRAFT";
    const reviewWorkflowState = input.submitForReview ? "PENDING_REVIEW" : "NONE";
    const report = await tx.marketReport.create({
      data: { ...values, coverMediaId, fileMediaId, status, reviewWorkflowState, approvedBy: null, publishedAt: null },
    });
    const after = state(report);
    await recordChange(tx, actor, report.id, null, after, ip, "market_report.create_draft", input.submitForReview ? "Created and submitted draft" : "Created draft");
    return { id: report.id, status, updatedAt: report.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function updateMarketReport(
  actor: SessionUser,
  input: MarketReportInput & { reportId: string; expectedUpdatedAt: string },
  ip: string | null,
) {
  requireEditor(actor);
  const values = validateInput(input);
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);
  return db.$transaction(async (tx) => {
    const report = await tx.marketReport.findUnique({ where: { id: input.reportId } });
    if (!report) throw new HttpError(404, "Market report not found.", "NOT_FOUND");
    if (report.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This report changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
    if (report.status === "RETIRED") throw new HttpError(409, "Restore this report as a draft before editing it.", "MARKET_REPORT_RETIRED");
    const coverMediaId = await ensureMedia(tx, values.coverMediaId, "IMAGE");
    const fileMediaId = await ensureMedia(tx, values.fileMediaId, "DOCUMENT");
    const before = state(report);
    const status = input.submitForReview ? "IN_REVIEW" : "DRAFT";
    const reviewWorkflowState = input.submitForReview ? "PENDING_REVIEW" : "NONE";
    const after: EditableReport = {
      ...values, coverMediaId, fileMediaId, status, reviewWorkflowState, approvedBy: null, publishedAt: null,
    };
    const changed = await tx.marketReport.updateMany({
      where: { id: report.id, updatedAt: expectedUpdatedAt },
      data: { ...after, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This report changed during save. Refresh and retry.", "VERSION_CONFLICT");
    await preserveSlug(tx, before, after);
    await recordChange(tx, actor, report.id, before, after, ip, "market_report.update_draft", input.submitForReview ? "Saved and submitted for review" : "Saved draft; publication cleared");
    const updated = await tx.marketReport.findUniqueOrThrow({ where: { id: report.id }, select: { updatedAt: true } });
    return { ok: true as const, status, reviewWorkflowState, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export type MarketReportReviewDecision = "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH";

export async function reviewMarketReport(
  actor: SessionUser,
  reportId: string,
  expectedUpdatedAtText: string,
  decision: MarketReportReviewDecision,
  note: string,
  ip: string | null,
) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or admin can review or publish market reports.", "MARKET_REPORT_REVIEW_FORBIDDEN");
  }
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const report = await tx.marketReport.findUnique({ where: { id: reportId } });
    if (!report) throw new HttpError(404, "Market report not found.", "NOT_FOUND");
    if (report.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This report changed since it was loaded. Refresh before reviewing.", "VERSION_CONFLICT");
    const before = state(report);
    const latest = await tx.marketReportRevision.findFirst({ where: { marketReportId: report.id }, orderBy: { version: "desc" } });
    let status = report.status;
    let reviewWorkflowState = report.reviewWorkflowState;
    let approvedBy = report.approvedBy;
    let publishedAt = report.publishedAt;
    let action: string;
    let eventType: "market-report.updated" | "market-report.published" = "market-report.updated";
    let revisionNote = note.trim();

    if (decision === "APPROVE" || decision === "CHANGES_REQUESTED") {
      if (report.status !== "IN_REVIEW" || report.reviewWorkflowState !== "PENDING_REVIEW") {
        throw new HttpError(409, "Only a pending-review report can receive this decision.", "REVIEW_STATE_CONFLICT");
      }
      if (latest?.editedBy === actor.id) throw new HttpError(409, "The most recent editor cannot review their own report revision.", "SELF_REVIEW_BLOCKED");
      if (decision === "APPROVE") {
        reviewWorkflowState = "APPROVED";
        approvedBy = actor.id;
        action = "market_report.approve";
        revisionNote ||= "Approved for publication";
      } else {
        if (!revisionNote) throw new HttpError(422, "A reason is required when requesting changes.", "REVIEW_NOTE_REQUIRED");
        status = "DRAFT";
        reviewWorkflowState = "CHANGES_REQUESTED";
        approvedBy = null;
        publishedAt = null;
        action = "market_report.changes_requested";
      }
    } else {
      if (report.status !== "IN_REVIEW" || report.reviewWorkflowState !== "APPROVED" || !report.approvedBy) {
        throw new HttpError(409, "The report must be approved before publication.", "APPROVAL_REQUIRED");
      }
      if (!report.title.trim() || !report.body.trim()) throw new HttpError(422, "A title and report body are required before publication.", "PUBLICATION_VALIDATION");
      if (!report.isIllustrative && (!report.dataSourceName || !report.dataSourceUrl || !report.retrievedAt || !report.methodology)) {
        throw new HttpError(422, "Non-illustrative publication requires an explicitly entered source, HTTP(S) source URL, retrieval time, and methodology. These fields do not constitute independent verification.", "REPORT_PROVENANCE_REQUIRED");
      }
      if (report.coverMediaId) await ensureMedia(tx, report.coverMediaId, "IMAGE");
      if (report.fileMediaId) await ensureMedia(tx, report.fileMediaId, "DOCUMENT");
      status = "PUBLISHED";
      publishedAt = new Date();
      action = "market_report.publish";
      revisionNote ||= "Published approved report revision";
      eventType = "market-report.published";
    }

    const after = { ...before, status, reviewWorkflowState, approvedBy, publishedAt };
    const changed = await tx.marketReport.updateMany({
      where: { id: report.id, updatedAt: expectedUpdatedAt },
      data: { status, reviewWorkflowState, approvedBy, publishedAt, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This report changed during review. Refresh and retry.", "VERSION_CONFLICT");
    await recordChange(tx, actor, report.id, before, after, ip, action, revisionNote, eventType);
    const updated = await tx.marketReport.findUniqueOrThrow({ where: { id: report.id }, select: { updatedAt: true } });
    return { ok: true as const, status, reviewWorkflowState, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function retireMarketReport(actor: SessionUser, reportId: string, expectedUpdatedAtText: string, restore: boolean, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const report = await tx.marketReport.findUnique({ where: { id: reportId } });
    if (!report) throw new HttpError(404, "Market report not found.", "NOT_FOUND");
    if (report.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This report changed since it was loaded. Refresh before changing its state.", "VERSION_CONFLICT");
    if (restore ? report.status !== "RETIRED" : report.status === "RETIRED") {
      throw new HttpError(409, restore ? "Only a retired report can be restored." : "This report is already retired.", "MARKET_REPORT_STATE");
    }
    const before = state(report);
    const after = { ...before, status: restore ? "DRAFT" : "RETIRED", reviewWorkflowState: "NONE", approvedBy: null, publishedAt: null };
    const changed = await tx.marketReport.updateMany({
      where: { id: report.id, updatedAt: expectedUpdatedAt },
      data: { status: after.status, reviewWorkflowState: "NONE", approvedBy: null, publishedAt: null, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, "This report changed during the archive action. Refresh and retry.", "VERSION_CONFLICT");
    await recordChange(tx, actor, report.id, before, after, ip, restore ? "market_report.restore_draft" : "market_report.retire", restore ? "Restored as an unpublished draft" : "Retired from public use");
    const updated = await tx.marketReport.findUniqueOrThrow({ where: { id: report.id }, select: { updatedAt: true } });
    return { ok: true as const, status: after.status, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function rollbackMarketReport(actor: SessionUser, reportId: string, revisionId: string, expectedUpdatedAtText: string, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const report = await tx.marketReport.findUnique({ where: { id: reportId } });
    if (!report) throw new HttpError(404, "Market report not found.", "NOT_FOUND");
    if (report.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This report changed since it was loaded. Refresh before restoring history.", "VERSION_CONFLICT");
    const revision = await tx.marketReportRevision.findFirst({ where: { id: revisionId, marketReportId: report.id } });
    if (!revision) throw new HttpError(404, "Report revision not found.", "REVISION_NOT_FOUND");
    let old: Record<string, unknown>;
    try { old = JSON.parse(revision.snapshotJson) as Record<string, unknown>; } catch { throw new HttpError(409, "Stored revision is invalid and cannot be restored.", "INVALID_REVISION"); }
    if (typeof old.slug !== "string" || typeof old.title !== "string" || typeof old.body !== "string") {
      throw new HttpError(409, "Stored revision is missing required fields.", "INVALID_REVISION");
    }
    const values = validateInput({
      slug: old.slug, title: old.title, summary: typeof old.summary === "string" ? old.summary : null,
      periodLabel: typeof old.periodLabel === "string" ? old.periodLabel : null,
      methodology: typeof old.methodology === "string" ? old.methodology : null,
      dataSourceName: typeof old.dataSourceName === "string" ? old.dataSourceName : null,
      dataSourceUrl: typeof old.dataSourceUrl === "string" ? old.dataSourceUrl : null,
      retrievedAt: typeof old.retrievedAt === "string" ? old.retrievedAt : null,
      body: old.body, coverMediaId: typeof old.coverMediaId === "string" ? old.coverMediaId : null,
      fileMediaId: typeof old.fileMediaId === "string" ? old.fileMediaId : null,
      gated: old.gated === true, isIllustrative: old.isIllustrative !== false,
    });
    const coverMediaId = await ensureMedia(tx, values.coverMediaId, "IMAGE");
    const fileMediaId = await ensureMedia(tx, values.fileMediaId, "DOCUMENT");
    const before = state(report);
    const after = { ...values, coverMediaId, fileMediaId, status: "DRAFT", reviewWorkflowState: "NONE", approvedBy: null, publishedAt: null };
    const changed = await tx.marketReport.updateMany({ where: { id: report.id, updatedAt: expectedUpdatedAt }, data: { ...after, updatedAt: new Date() } });
    if (changed.count !== 1) throw new HttpError(409, "This report changed during restore. Refresh and retry.", "VERSION_CONFLICT");
    await preserveSlug(tx, before, after);
    await recordChange(tx, actor, report.id, before, after, ip, "market_report.restore_revision", `Restored revision ${revision.version} as a draft`);
    const updated = await tx.marketReport.findUniqueOrThrow({ where: { id: report.id }, select: { updatedAt: true } });
    return { ok: true as const, status: "DRAFT", updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

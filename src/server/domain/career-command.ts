import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { audit, HttpError } from "@/server/auth";
import { careerDraftSchema, validCareerApplication, type CareerDraft } from "@/lib/career-opening";
export type { CareerDraft } from "@/lib/career-opening";

function validate(input: CareerDraft) {
  const parsed = careerDraftSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, "Enter valid career fields and dates.", "CAREER_FIELD_INVALID");
  const draft = parsed.data;
  if (!validCareerApplication(draft)) throw new HttpError(422, "Choose contact, a valid application email, or an HTTPS application URL.", "CAREER_APPLICATION_INVALID");
  if (draft.opensAt && draft.closesAt && new Date(draft.closesAt) <= new Date(draft.opensAt)) throw new HttpError(422, "The closing date must be after the opening date.", "CAREER_DATES_INVALID");
  return { ...draft, opensAt: draft.opensAt ? new Date(draft.opensAt) : null, closesAt: draft.closesAt ? new Date(draft.closesAt) : null };
}

function snapshot(record: Record<string, unknown>) {
  return JSON.stringify({
    slug: record.slug, locale: record.locale, title: record.title, department: record.department,
    location: record.location, employmentType: record.employmentType, workplaceType: record.workplaceType,
    summary: record.summary, description: record.description, status: record.status,
    responsibilities: record.responsibilities, requirements: record.requirements, benefits: record.benefits,
    salaryDisclosure: record.salaryDisclosure, applicationMethod: record.applicationMethod, applicationTarget: record.applicationTarget,
    seoTitle: record.seoTitle, seoDescription: record.seoDescription,
    opensAt: record.opensAt instanceof Date ? record.opensAt.toISOString() : record.opensAt ?? null,
    reviewWorkflowState: record.reviewWorkflowState,
    closesAt: record.closesAt instanceof Date ? record.closesAt.toISOString() : record.closesAt ?? null,
    publishedAt: record.publishedAt instanceof Date ? record.publishedAt.toISOString() : record.publishedAt ?? null,
  });
}

async function recordRevision(tx: Prisma.TransactionClient, actor: SessionUser, entry: Record<string, unknown> & { id: string }, note: string, action: string, ip: string | null, before?: unknown) {
  const aggregate = await tx.careerOpeningRevision.aggregate({ where: { careerOpeningId: entry.id }, _max: { version: true } });
  const version = (aggregate._max.version ?? 0) + 1;
  await tx.careerOpeningRevision.create({ data: { careerOpeningId: entry.id, version, snapshotJson: snapshot(entry), editedBy: actor.id, changeNote: note.slice(0, 300) } });
  await audit({ actorId: actor.id, organizationId: actor.organizationId, action, resourceType: "career_opening", resourceId: entry.id, before, after: { ...entry, version }, ip }, tx);
}

export async function createCareerOpening(actor: SessionUser, input: CareerDraft, ip: string | null) {
  const draft = validate(input);
  try {
    return await db.$transaction(async (tx) => {
      const entry = await tx.careerOpening.create({
        data: { ...draft, createdBy: actor.id },
      });
      await recordRevision(tx, actor, entry, "Created unpublished opening", "career.create_draft", ip);
      return { id: entry.id, updatedAt: entry.updatedAt.toISOString(), status: entry.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "That career page slug is already in use for this language.", "CAREER_SLUG_CONFLICT");
    throw error;
  }
}

export async function updateCareerOpening(actor: SessionUser, input: CareerDraft & { careerOpeningId: string; expectedUpdatedAt: string; submitForReview?: boolean }, ip: string | null) {
  const draft = validate(input);
  const expected = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid opening version.", "INVALID_VERSION");
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.careerOpening.findUnique({ where: { id: input.careerOpeningId } });
      if (!current) throw new HttpError(404, "Career opening not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This role changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      if (current.status === "CLOSED" || current.status === "RETIRED") throw new HttpError(409, "Closed roles cannot be edited. Restore through a new draft.", "CAREER_CLOSED");
      const next = {
        ...draft,
        status: input.submitForReview ? "IN_REVIEW" : "DRAFT",
        reviewWorkflowState: input.submitForReview ? "PENDING_REVIEW" : "NONE",
        publishedAt: null,
      };
      const changed = await tx.careerOpening.updateMany({ where: { id: current.id, updatedAt: expected }, data: { ...next, updatedAt: new Date() } });
      if (changed.count !== 1) throw new HttpError(409, "This role changed while saving. Refresh and retry.", "VERSION_CONFLICT");
      const updated = await tx.careerOpening.findUniqueOrThrow({ where: { id: current.id } });
      await recordRevision(tx, actor, updated, input.submitForReview ? "Submitted role for review" : "Saved role draft", "career.update", ip, current);
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString(), status: updated.status, reviewWorkflowState: updated.reviewWorkflowState };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "That career page slug is already in use for this language.", "CAREER_SLUG_CONFLICT");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new HttpError(409, "This role changed while saving. Refresh and retry.", "VERSION_CONFLICT");
    throw error;
  }
}

export async function reviewCareerOpening(actor: SessionUser, id: string, expectedUpdatedAt: string, decision: "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH", note: string, ip: string | null) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) throw new HttpError(403, "Only an owner or admin can review and publish career openings.", "CAREER_REVIEW_FORBIDDEN");
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid opening version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const current = await tx.careerOpening.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Career opening not found.", "NOT_FOUND");
    if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This role changed since it was loaded. Refresh before review.", "VERSION_CONFLICT");
    const latest = await tx.careerOpeningRevision.findFirst({ where: { careerOpeningId: id }, orderBy: { version: "desc" } });
    if (decision !== "PUBLISH" && latest?.editedBy === actor.id) throw new HttpError(409, "The latest editor cannot review their own role revision.", "SELF_REVIEW_BLOCKED");
    if (decision === "APPROVE" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "PENDING_REVIEW")) throw new HttpError(409, "Only pending roles can be approved.", "REVIEW_STATE_CONFLICT");
    if (decision === "CHANGES_REQUESTED" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "PENDING_REVIEW")) throw new HttpError(409, "Only pending roles can receive requested changes.", "REVIEW_STATE_CONFLICT");
    if (decision === "CHANGES_REQUESTED" && !note.trim()) throw new HttpError(422, "Explain the requested changes.", "REVIEW_NOTE_REQUIRED");
    if (decision === "PUBLISH" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "APPROVED")) throw new HttpError(409, "Approve the current role revision before publishing.", "APPROVAL_REQUIRED");
    if (decision === "APPROVE" || decision === "PUBLISH") {
      if (!current.requirements.trim()) throw new HttpError(422, "Add role requirements before approval.", "CAREER_REQUIREMENTS_REQUIRED");
      if (current.closesAt && current.closesAt <= new Date()) throw new HttpError(422, "The application closing date has passed.", "CAREER_EXPIRED");
      if (!validCareerApplication(current)) throw new HttpError(422, "The application destination is invalid.", "CAREER_APPLICATION_INVALID");
    }
    const next = decision === "APPROVE" ? { status: "IN_REVIEW", reviewWorkflowState: "APPROVED", publishedAt: null }
      : decision === "CHANGES_REQUESTED" ? { status: "DRAFT", reviewWorkflowState: "CHANGES_REQUESTED", publishedAt: null }
        : { status: "PUBLISHED", reviewWorkflowState: "APPROVED", publishedAt: new Date() };
    const changed = await tx.careerOpening.updateMany({ where: { id, updatedAt: expected }, data: { ...next, updatedAt: new Date() } });
    if (changed.count !== 1) throw new HttpError(409, "This role changed during review. Refresh and retry.", "VERSION_CONFLICT");
    const updated = await tx.careerOpening.findUniqueOrThrow({ where: { id } });
    await recordRevision(tx, actor, updated, note.trim() || (decision === "PUBLISH" ? "Published approved opening" : "Approved role revision"), `career.${decision.toLowerCase()}`, ip, current);
    return { ok: true as const, status: updated.status, reviewWorkflowState: updated.reviewWorkflowState, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function closeCareerOpening(actor: SessionUser, id: string, expectedUpdatedAt: string, retire: boolean, ip: string | null) {
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid opening version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const current = await tx.careerOpening.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Career opening not found.", "NOT_FOUND");
    if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This role changed since it was loaded. Refresh before closing.", "VERSION_CONFLICT");
    if (current.status === "RETIRED" || (current.status === "CLOSED" && !retire)) throw new HttpError(409, "This role is already closed.", "CAREER_CLOSED");
    const updated = await tx.careerOpening.update({ where: { id }, data: { status: retire ? "RETIRED" : "CLOSED", reviewWorkflowState: "NONE", publishedAt: null } });
    await recordRevision(tx, actor, updated, retire ? "Retired role" : "Closed role", retire ? "career.retire" : "career.close", ip, current);
    return { ok: true as const, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function restoreCareerOpening(actor: SessionUser, id: string, expectedUpdatedAt: string, ip: string | null) {
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid opening version.", "INVALID_VERSION");
  return db.$transaction(async (tx) => {
    const current = await tx.careerOpening.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Career opening not found.", "NOT_FOUND");
    if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This role changed. Refresh before restoring it.", "VERSION_CONFLICT");
    if (!["CLOSED", "RETIRED"].includes(current.status)) throw new HttpError(409, "Only closed or archived openings can be restored.", "CAREER_RESTORE_STATE");
    const updated = await tx.careerOpening.update({ where: { id }, data: { status: "DRAFT", reviewWorkflowState: "NONE", publishedAt: null } });
    await recordRevision(tx, actor, updated, "Restored opening as a private draft", "career.restore_draft", ip, current);
    return { ok: true as const, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { audit, HttpError } from "@/server/auth";

export type CareerDraft = {
  locale: "en" | "ar";
  slug: string;
  title: string;
  department: string;
  location: string;
  employmentType: string;
  workplaceType: string;
  summary: string;
  description: string;
  closesAt?: string | null;
};

function validate(input: CareerDraft) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim().toLowerCase())) throw new HttpError(422, "Use a URL-safe role slug.", "CAREER_SLUG_INVALID");
  for (const [field, value, max] of [["title", input.title, 180], ["department", input.department, 100], ["location", input.location, 120], ["employment type", input.employmentType, 80], ["workplace type", input.workplaceType, 80], ["summary", input.summary, 1000], ["description", input.description, 12000]] as const) {
    if (!value.trim() || value.length > max) throw new HttpError(422, `Enter a valid ${field}.`, "CAREER_FIELD_INVALID");
  }
  if (input.closesAt && !Number.isFinite(new Date(input.closesAt).getTime())) throw new HttpError(422, "Use a valid closing date.", "CAREER_CLOSE_DATE_INVALID");
}

function snapshot(record: Record<string, unknown>) {
  return JSON.stringify({
    slug: record.slug, locale: record.locale, title: record.title, department: record.department,
    location: record.location, employmentType: record.employmentType, workplaceType: record.workplaceType,
    summary: record.summary, description: record.description, status: record.status,
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
  validate(input);
  try {
    return await db.$transaction(async (tx) => {
      const entry = await tx.careerOpening.create({
        data: { ...input, slug: input.slug.trim().toLowerCase(), title: input.title.trim(), department: input.department.trim(), location: input.location.trim(), employmentType: input.employmentType.trim(), workplaceType: input.workplaceType.trim(), summary: input.summary.trim(), description: input.description.trim(), closesAt: input.closesAt ? new Date(input.closesAt) : null, createdBy: actor.id },
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
  validate(input);
  const expected = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new HttpError(400, "Invalid opening version.", "INVALID_VERSION");
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.careerOpening.findUnique({ where: { id: input.careerOpeningId } });
      if (!current) throw new HttpError(404, "Career opening not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expected.getTime()) throw new HttpError(409, "This role changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      if (current.status === "CLOSED" || current.status === "RETIRED") throw new HttpError(409, "Closed roles cannot be edited. Restore through a new draft.", "CAREER_CLOSED");
      const next = {
        locale: input.locale, slug: input.slug.trim().toLowerCase(), title: input.title.trim(), department: input.department.trim(), location: input.location.trim(),
        employmentType: input.employmentType.trim(), workplaceType: input.workplaceType.trim(), summary: input.summary.trim(), description: input.description.trim(),
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
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
    if (latest?.editedBy === actor.id) throw new HttpError(409, "The latest editor cannot review their own role revision.", "SELF_REVIEW_BLOCKED");
    if (decision === "APPROVE" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "PENDING_REVIEW")) throw new HttpError(409, "Only pending roles can be approved.", "REVIEW_STATE_CONFLICT");
    if (decision === "CHANGES_REQUESTED" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "PENDING_REVIEW")) throw new HttpError(409, "Only pending roles can receive requested changes.", "REVIEW_STATE_CONFLICT");
    if (decision === "CHANGES_REQUESTED" && !note.trim()) throw new HttpError(422, "Explain the requested changes.", "REVIEW_NOTE_REQUIRED");
    if (decision === "PUBLISH" && !(current.status === "IN_REVIEW" && current.reviewWorkflowState === "APPROVED")) throw new HttpError(409, "Approve the current role revision before publishing.", "APPROVAL_REQUIRED");
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
    if (current.status === "CLOSED" || current.status === "RETIRED") throw new HttpError(409, "This role is already closed.", "CAREER_CLOSED");
    const updated = await tx.careerOpening.update({ where: { id }, data: { status: retire ? "RETIRED" : "CLOSED", reviewWorkflowState: "NONE", publishedAt: null } });
    await recordRevision(tx, actor, updated, retire ? "Retired role" : "Closed role", retire ? "career.retire" : "career.close", ip, current);
    return { ok: true as const, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

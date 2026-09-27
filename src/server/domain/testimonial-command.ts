import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";

export interface TestimonialInput {
  clientName: string;
  clientRole?: string | null;
  quote: string;
  rating?: number | null;
  propertyContextId?: string | null;
}

interface TestimonialContent extends TestimonialInput {
  clientRole: string | null;
  rating: number | null;
  propertyContextId: string | null;
}

function requireEditor(actor: SessionUser) {
  if (!actor.roles.some((role) => ["OWNER", "ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new HttpError(403, "You cannot manage testimonials.", "TESTIMONIAL_EDIT_FORBIDDEN");
  }
}

function requireReviewer(actor: SessionUser) {
  if (!actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
    throw new HttpError(403, "Only an owner or admin can verify and publish testimonials.", "TESTIMONIAL_REVIEW_FORBIDDEN");
  }
}

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid testimonial version.", "INVALID_VERSION");
  return parsed;
}

function clean(value: string | null | undefined, max: number) {
  return value?.trim().slice(0, max) || null;
}

function validateContent(input: TestimonialInput): TestimonialContent {
  const clientName = input.clientName.trim();
  const quote = input.quote.trim();
  if (!clientName || clientName.length > 160 || !quote || quote.length > 5000) {
    throw new HttpError(422, "Enter the client's supplied name and testimonial within the allowed lengths.", "TESTIMONIAL_VALIDATION");
  }
  if (input.rating !== undefined && input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
    throw new HttpError(422, "Rating must be an explicitly supplied integer from 1 to 5.", "TESTIMONIAL_RATING_INVALID");
  }
  return {
    clientName,
    clientRole: clean(input.clientRole, 160),
    quote,
    rating: input.rating ?? null,
    propertyContextId: clean(input.propertyContextId, 180),
  };
}

function evidenceReference(value: string, label: string) {
  const normalized = value.trim();
  // Store an opaque internal evidence pointer, not the evidence itself, a public URL, or client PII.
  if (normalized.length < 3 || normalized.length > 180 || normalized.includes("://") || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(normalized)) {
    throw new HttpError(422, `${label} must be an opaque internal reference (letters, numbers, /, :, ., _, or - only).`, "TESTIMONIAL_EVIDENCE_REFERENCE_INVALID");
  }
  return normalized;
}

function consentDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now()) {
    throw new HttpError(422, "Enter the real consent capture time; it cannot be in the future.", "TESTIMONIAL_CONSENT_DATE_INVALID");
  }
  return parsed;
}

function revisionSnapshot(content: TestimonialContent) {
  // Consent and verification evidence references are deliberately kept out of content history.
  return JSON.stringify(content);
}

function auditState(record: {
  clientName: string; clientRole: string | null; quote: string; rating: number | null; propertyContextId: string | null;
  status: string; verified: boolean; verifiedAt: Date | null; consentCapturedAt: Date | null;
  verificationEvidenceRef: string | null; consentEvidenceRef: string | null;
}) {
  return {
    clientName: record.clientName, clientRole: record.clientRole, quote: record.quote, rating: record.rating,
    propertyContextId: record.propertyContextId, status: record.status, verified: record.verified,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    consentCapturedAt: record.consentCapturedAt?.toISOString() ?? null,
    hasVerificationEvidence: Boolean(record.verificationEvidenceRef), hasConsentEvidence: Boolean(record.consentEvidenceRef),
  };
}

async function recordChange(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  testimonialId: string,
  content: TestimonialContent,
  status: string,
  ip: string | null,
  action: string,
  note: string,
  before?: ReturnType<typeof auditState>,
  record?: Parameters<typeof auditState>[0],
) {
  const latest = await tx.testimonialRevision.aggregate({ where: { testimonialId }, _max: { version: true } });
  await tx.testimonialRevision.create({
    data: {
      testimonialId,
      version: (latest._max.version ?? 0) + 1,
      snapshotJson: revisionSnapshot(content),
      editedBy: actor.id,
      changeNote: note.slice(0, 300),
    },
  });
  await audit({
    actorId: actor.id,
    organizationId: actor.organizationId,
    action,
    resourceType: "testimonial",
    resourceId: testimonialId,
    before,
    after: record ? auditState(record) : { ...content, status, verified: false },
    ip,
  }, tx);
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "The testimonial changed during save. Refresh and retry.", "VERSION_CONFLICT");
  }
  throw error;
}

export async function createTestimonial(actor: SessionUser, input: TestimonialInput, ip: string | null) {
  requireEditor(actor);
  const content = validateContent(input);
  return db.$transaction(async (tx) => {
    const testimonial = await tx.testimonial.create({
      data: {
        ...content,
        status: "DRAFT",
        verified: false,
        verifiedAt: null,
        verificationEvidenceRef: null,
        consentCapturedAt: null,
        consentEvidenceRef: null,
      },
    });
    await recordChange(tx, actor, testimonial.id, content, "DRAFT", ip, "testimonial.create_draft", "Created draft");
    return { id: testimonial.id, status: "DRAFT", updatedAt: testimonial.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function updateTestimonial(
  actor: SessionUser,
  input: TestimonialInput & { testimonialId: string; expectedUpdatedAt: string },
  ip: string | null,
) {
  requireEditor(actor);
  const content = validateContent(input);
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);
  return db.$transaction(async (tx) => {
    const testimonial = await tx.testimonial.findUnique({ where: { id: input.testimonialId } });
    if (!testimonial) throw new HttpError(404, "Testimonial not found.", "NOT_FOUND");
    if (testimonial.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This testimonial changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
    if (testimonial.status === "RETIRED") throw new HttpError(409, "Restore this testimonial as a draft before editing it.", "TESTIMONIAL_RETIRED");
    const before = auditState(testimonial);
    const changed = await tx.testimonial.updateMany({
      where: { id: testimonial.id, updatedAt: expectedUpdatedAt },
      data: {
        ...content,
        status: "DRAFT",
        verified: false,
        verifiedAt: null,
        verificationEvidenceRef: null,
        consentCapturedAt: null,
        consentEvidenceRef: null,
        updatedAt: new Date(),
      },
    });
    if (changed.count !== 1) throw new HttpError(409, "This testimonial changed during save. Refresh and retry.", "VERSION_CONFLICT");
    const updated = await tx.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    await recordChange(tx, actor, testimonial.id, content, "DRAFT", ip, "testimonial.update_draft", "Saved draft; verification and consent cleared", before, updated);
    return { ok: true as const, status: "DRAFT", updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function publishTestimonial(
  actor: SessionUser,
  testimonialId: string,
  expectedUpdatedAtText: string,
  input: { verificationEvidenceRef: string; consentEvidenceRef: string; consentCapturedAt: string; reviewNote: string },
  ip: string | null,
) {
  requireReviewer(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  const verificationEvidenceRef = evidenceReference(input.verificationEvidenceRef, "Verification evidence reference");
  const consentEvidenceRef = evidenceReference(input.consentEvidenceRef, "Consent evidence reference");
  const consentCapturedAt = consentDate(input.consentCapturedAt);
  const reviewNote = input.reviewNote.trim();
  if (reviewNote.length < 3 || reviewNote.length > 1000) throw new HttpError(422, "Add a brief note explaining the verification decision.", "TESTIMONIAL_REVIEW_NOTE_REQUIRED");
  return db.$transaction(async (tx) => {
    const testimonial = await tx.testimonial.findUnique({ where: { id: testimonialId } });
    if (!testimonial) throw new HttpError(404, "Testimonial not found.", "NOT_FOUND");
    if (testimonial.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This testimonial changed since it was loaded. Refresh before reviewing.", "VERSION_CONFLICT");
    if (testimonial.status !== "DRAFT") throw new HttpError(409, "Only a draft testimonial can be reviewed and published.", "TESTIMONIAL_STATE_CONFLICT");
    if (!testimonial.clientName.trim() || !testimonial.quote.trim()) throw new HttpError(422, "A supplied client name and quote are required.", "TESTIMONIAL_PUBLICATION_VALIDATION");
    const latest = await tx.testimonialRevision.findFirst({ where: { testimonialId }, orderBy: { version: "desc" } });
    if (!latest || latest.editedBy === actor.id) throw new HttpError(409, "A different owner or admin must verify the latest edited testimonial.", "SELF_REVIEW_BLOCKED");
    const before = auditState(testimonial);
    const changed = await tx.testimonial.updateMany({
      where: { id: testimonialId, updatedAt: expectedUpdatedAt },
      data: {
        status: "PUBLISHED",
        verified: true,
        verifiedAt: new Date(),
        verificationEvidenceRef,
        consentCapturedAt,
        consentEvidenceRef,
        updatedAt: new Date(),
      },
    });
    if (changed.count !== 1) throw new HttpError(409, "This testimonial changed during review. Refresh and retry.", "VERSION_CONFLICT");
    const updated = await tx.testimonial.findUniqueOrThrow({ where: { id: testimonialId } });
    const content = validateContent(testimonial);
    await recordChange(tx, actor, testimonialId, content, "PUBLISHED", ip, "testimonial.verify_publish", reviewNote, before, updated);
    return { ok: true as const, status: "PUBLISHED", updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function retireTestimonial(actor: SessionUser, testimonialId: string, expectedUpdatedAtText: string, restore: boolean, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const testimonial = await tx.testimonial.findUnique({ where: { id: testimonialId } });
    if (!testimonial) throw new HttpError(404, "Testimonial not found.", "NOT_FOUND");
    if (testimonial.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This testimonial changed since it was loaded. Refresh before changing its state.", "VERSION_CONFLICT");
    const targetStatus = restore ? "DRAFT" : "RETIRED";
    if (restore ? testimonial.status !== "RETIRED" : testimonial.status === "RETIRED") {
      throw new HttpError(409, restore ? "Only a retired testimonial can be restored." : "This testimonial is already retired.", "TESTIMONIAL_STATE_CONFLICT");
    }
    const before = auditState(testimonial);
    const changed = await tx.testimonial.updateMany({
      where: { id: testimonialId, updatedAt: expectedUpdatedAt },
      data: {
        status: targetStatus,
        verified: false,
        verifiedAt: null,
        verificationEvidenceRef: null,
        consentCapturedAt: null,
        consentEvidenceRef: null,
        updatedAt: new Date(),
      },
    });
    if (changed.count !== 1) throw new HttpError(409, "This testimonial changed during the state change. Refresh and retry.", "VERSION_CONFLICT");
    const updated = await tx.testimonial.findUniqueOrThrow({ where: { id: testimonialId } });
    const content = validateContent(testimonial);
    await recordChange(tx, actor, testimonialId, content, targetStatus, ip, restore ? "testimonial.restore_draft" : "testimonial.retire", restore ? "Restored as draft; proof must be supplied again" : "Retired", before, updated);
    return { ok: true as const, status: targetStatus, updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

export async function rollbackTestimonial(actor: SessionUser, testimonialId: string, revisionId: string, expectedUpdatedAtText: string, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  return db.$transaction(async (tx) => {
    const testimonial = await tx.testimonial.findUnique({ where: { id: testimonialId } });
    if (!testimonial) throw new HttpError(404, "Testimonial not found.", "NOT_FOUND");
    if (testimonial.status === "RETIRED") throw new HttpError(409, "Restore this testimonial before restoring a revision.", "TESTIMONIAL_RETIRED");
    if (testimonial.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This testimonial changed since it was loaded. Refresh before restoring.", "VERSION_CONFLICT");
    const revision = await tx.testimonialRevision.findFirst({ where: { id: revisionId, testimonialId } });
    if (!revision) throw new HttpError(404, "Testimonial revision not found.", "REVISION_NOT_FOUND");
    let restored: TestimonialContent;
    try { restored = validateContent(JSON.parse(revision.snapshotJson) as TestimonialInput); }
    catch { throw new HttpError(422, "This historical revision cannot be restored.", "REVISION_INVALID"); }
    const before = auditState(testimonial);
    const changed = await tx.testimonial.updateMany({
      where: { id: testimonialId, updatedAt: expectedUpdatedAt },
      data: {
        ...restored, status: "DRAFT", verified: false, verifiedAt: null, verificationEvidenceRef: null,
        consentCapturedAt: null, consentEvidenceRef: null, updatedAt: new Date(),
      },
    });
    if (changed.count !== 1) throw new HttpError(409, "This testimonial changed during restore. Refresh and retry.", "VERSION_CONFLICT");
    const updated = await tx.testimonial.findUniqueOrThrow({ where: { id: testimonialId } });
    await recordChange(tx, actor, testimonialId, restored, "DRAFT", ip, "testimonial.restore_revision_as_draft", `Restored revision ${revision.version} as draft`, before, updated);
    return { ok: true as const, status: "DRAFT", updatedAt: updated.updatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(translateWriteError);
}

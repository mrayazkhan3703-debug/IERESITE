import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createTestimonial, publishTestimonial, retireTestimonial, rollbackTestimonial, updateTestimonial } from "@/server/domain/testimonial-command";
import { PUBLIC_TESTIMONIAL_WHERE } from "@/server/domain/visibility";

const prefix = `testimonial-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const editorId = `${prefix}-editor`;
const reviewerId = `${prefix}-reviewer`;
const editor: SessionUser = {
  sessionId: `${prefix}-editor-session`, id: editorId, email: "testimonial-editor@example.invalid", name: "Testimonial editor",
  organizationId: null, roles: ["CONTENT_EDITOR"], permissions: ["content:update"], mfaVerified: true,
};
const reviewer: SessionUser = {
  sessionId: `${prefix}-reviewer-session`, id: reviewerId, email: "testimonial-reviewer@example.invalid", name: "Testimonial reviewer",
  organizationId: null, roles: ["ADMIN"], permissions: ["content:update"], mfaVerified: true,
};

async function cleanup() {
  const testimonials = await db.testimonial.findMany({ where: { clientName: { startsWith: prefix } }, select: { id: true } });
  const ids = testimonials.map((entry) => entry.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
    await db.testimonial.deleteMany({ where: { id: { in: ids } } });
  }
  await db.user.deleteMany({ where: { id: { in: [editorId, reviewerId] } } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: editorId, email: editor.email } });
  await db.user.create({ data: { id: reviewerId, email: reviewer.email } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("transactional testimonial moderation commands", () => {
  test("keeps drafts private, requires independent evidence-backed review, and clears consent on edits", async () => {
    const created = await createTestimonial(editor, {
      clientName: `${prefix} real client`, clientRole: "Fixture role", quote: "Fixture quote supplied for the integration test.", rating: 5,
    }, "127.0.0.1");
    let testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: created.id } });
    expect(testimonial.status).toBe("DRAFT");
    expect(testimonial.verified).toBe(false);
    expect(testimonial.consentCapturedAt).toBeNull();
    expect(await db.testimonial.findFirst({ where: { ...PUBLIC_TESTIMONIAL_WHERE, id: testimonial.id } })).toBeNull();
    expect(await db.testimonialRevision.count({ where: { testimonialId: testimonial.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { resourceId: testimonial.id, action: "testimonial.create_draft" } })).toBe(1);

    await expect(publishTestimonial(editor, testimonial.id, testimonial.updatedAt.toISOString(), {
      verificationEvidenceRef: "internal:verification-1", consentEvidenceRef: "internal:consent-1",
      consentCapturedAt: new Date(Date.now() - 60_000).toISOString(), reviewNote: "Reviewed actual fixture",
    }, null)).rejects.toMatchObject({ status: 403, code: "TESTIMONIAL_REVIEW_FORBIDDEN" });
    await expect(publishTestimonial(reviewer, testimonial.id, testimonial.updatedAt.toISOString(), {
      verificationEvidenceRef: "https://example.invalid/evidence", consentEvidenceRef: "internal:consent-1",
      consentCapturedAt: new Date(Date.now() - 60_000).toISOString(), reviewNote: "Reviewed actual fixture",
    }, null)).rejects.toMatchObject({ status: 422, code: "TESTIMONIAL_EVIDENCE_REFERENCE_INVALID" });
    await updateTestimonial(reviewer, {
      testimonialId: testimonial.id, expectedUpdatedAt: testimonial.updatedAt.toISOString(),
      clientName: testimonial.clientName, clientRole: testimonial.clientRole, quote: testimonial.quote, rating: testimonial.rating,
    }, null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    await expect(publishTestimonial(reviewer, testimonial.id, testimonial.updatedAt.toISOString(), {
      verificationEvidenceRef: "internal:verification-1", consentEvidenceRef: "internal:consent-1",
      consentCapturedAt: new Date(Date.now() - 60_000).toISOString(), reviewNote: "Reviewed actual fixture",
    }, null)).rejects.toMatchObject({ status: 409, code: "SELF_REVIEW_BLOCKED" });
    await updateTestimonial(editor, {
      testimonialId: testimonial.id, expectedUpdatedAt: testimonial.updatedAt.toISOString(),
      clientName: testimonial.clientName, clientRole: testimonial.clientRole, quote: testimonial.quote, rating: testimonial.rating,
    }, null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });

    await publishTestimonial(reviewer, testimonial.id, testimonial.updatedAt.toISOString(), {
      verificationEvidenceRef: "internal:verification-1", consentEvidenceRef: "internal:consent-1",
      consentCapturedAt: new Date(Date.now() - 60_000).toISOString(), reviewNote: "Checked supplied quote and consent record",
    }, "127.0.0.1");
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    expect(testimonial.status).toBe("PUBLISHED");
    expect(testimonial.verified).toBe(true);
    expect(testimonial.verificationEvidenceRef).toBe("internal:verification-1");
    expect(await db.testimonial.findFirst({ where: { ...PUBLIC_TESTIMONIAL_WHERE, id: testimonial.id } })).not.toBeNull();

    const originalRevision = await db.testimonialRevision.findFirstOrThrow({ where: { testimonialId: testimonial.id, version: 1 } });
    await expect(updateTestimonial(editor, {
      testimonialId: testimonial.id, expectedUpdatedAt: new Date(testimonial.updatedAt.getTime() - 1).toISOString(),
      clientName: `${prefix} stale edit`, quote: "Must not overwrite.",
    }, null)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    await updateTestimonial(editor, {
      testimonialId: testimonial.id, expectedUpdatedAt: testimonial.updatedAt.toISOString(),
      clientName: testimonial.clientName, clientRole: testimonial.clientRole, quote: "Edited quote needs fresh consent.", rating: testimonial.rating,
    }, null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    expect(testimonial.status).toBe("DRAFT");
    expect(testimonial.verified).toBe(false);
    expect(testimonial.verifiedAt).toBeNull();
    expect(testimonial.verificationEvidenceRef).toBeNull();
    expect(testimonial.consentCapturedAt).toBeNull();
    expect(await db.testimonial.findFirst({ where: { ...PUBLIC_TESTIMONIAL_WHERE, id: testimonial.id } })).toBeNull();

    await rollbackTestimonial(editor, testimonial.id, originalRevision.id, testimonial.updatedAt.toISOString(), null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    expect(testimonial.quote).toBe("Fixture quote supplied for the integration test.");
    expect(testimonial.status).toBe("DRAFT");
    expect(testimonial.consentCapturedAt).toBeNull();
    expect(await db.testimonialRevision.count({ where: { testimonialId: testimonial.id } })).toBe(6);

    await retireTestimonial(editor, testimonial.id, testimonial.updatedAt.toISOString(), false, null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    expect(testimonial.status).toBe("RETIRED");
    await retireTestimonial(editor, testimonial.id, testimonial.updatedAt.toISOString(), true, null);
    testimonial = await db.testimonial.findUniqueOrThrow({ where: { id: testimonial.id } });
    expect(testimonial.status).toBe("DRAFT");
    expect(testimonial.verified).toBe(false);
    expect(await db.testimonialRevision.count({ where: { testimonialId: testimonial.id } })).toBe(8);
  });
});

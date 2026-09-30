import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createCareerOpening, updateCareerOpening, reviewCareerOpening, closeCareerOpening, restoreCareerOpening, type CareerDraft } from "@/server/domain/career-command";
import { publicCareerWhere } from "@/server/domain/career-query";
import { GET as careerDetail } from "@/app/api/careers/openings/[slug]/route";

const prefix = `career-command-${Date.now()}`;
const editor: SessionUser = { sessionId: `${prefix}-session`, id: `${prefix}-editor`, email: `${prefix}-editor@example.invalid`, name: "Career fixture", organizationId: null, roles: ["OWNER"], permissions: ["content:update"], mfaVerified: true };
const reviewer: SessionUser = { ...editor, id: `${prefix}-reviewer`, email: `${prefix}-reviewer@example.invalid`, roles: ["ADMIN"] };
const draft = (suffix: string): CareerDraft => ({ locale: "en", slug: `${prefix}-${suffix}`, title: "Synthetic career role", department: "Fixture", location: "Fixture office", employmentType: "Full-time", workplaceType: "On-site", summary: "Synthetic CI record", description: "Test role only", requirements: "Required fixture qualification", responsibilities: "Fixture responsibility", salaryDisclosure: "Synthetic approved disclosure", applicationMethod: "URL", applicationTarget: "https://example.invalid/apply", seoTitle: "Synthetic role SEO", seoDescription: "Synthetic role description" });
beforeAll(async () => { for (const actor of [editor, reviewer]) await db.user.create({ data: { id: actor.id, email: actor.email } }); });
afterAll(async () => {
  const rows = await db.careerOpening.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { resourceId: { in: rows.map((row) => row.id) } } });
  await db.careerOpening.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [editor.id, reviewer.id] } } });
  await db.$disconnect();
});

describe("career publication and privacy", () => {
  test("requires independent approval, permits the approver to publish, and closes reversibly", async () => {
    const input = draft("lifecycle");
    const created = await createCareerOpening(editor, input, null);
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en") } })).toBe(0);
    await expect(reviewCareerOpening(reviewer, created.id, created.updatedAt, "PUBLISH", "", null)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const submitted = await updateCareerOpening(editor, { ...input, careerOpeningId: created.id, expectedUpdatedAt: created.updatedAt, submitForReview: true }, null);
    await expect(reviewCareerOpening(editor, created.id, submitted.updatedAt, "APPROVE", "", null)).rejects.toMatchObject({ code: "SELF_REVIEW_BLOCKED" });
    const approved = await reviewCareerOpening(reviewer, created.id, submitted.updatedAt, "APPROVE", "Reviewed fixture", null);
    const published = await reviewCareerOpening(reviewer, created.id, approved.updatedAt, "PUBLISH", "", null);
    const response = await careerDetail(new Request(`http://localhost/api/careers/openings/${input.slug}`), { params: Promise.resolve({ slug: input.slug }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.opening.requirements).toBe(input.requirements);
    expect(body.opening.applicationTarget).toBe(input.applicationTarget);
    expect(body.opening.createdBy).toBeUndefined();
    expect(body.opening.revisions).toBeUndefined();
    const latest = await db.careerOpeningRevision.findFirstOrThrow({ where: { careerOpeningId: created.id }, orderBy: { version: "desc" } });
    expect(JSON.parse(latest.snapshotJson).salaryDisclosure).toBe(input.salaryDisclosure);
    await expect(updateCareerOpening(editor, { ...input, careerOpeningId: created.id, expectedUpdatedAt: created.updatedAt }, null)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const closed = await closeCareerOpening(editor, created.id, published.updatedAt, false, null);
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en") } })).toBe(0);
    expect(await db.careerOpeningRevision.count({ where: { careerOpeningId: created.id } })).toBe(5);
    const restored = await restoreCareerOpening(editor, created.id, closed.updatedAt, null);
    expect(restored.status).toBe("DRAFT");
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en") } })).toBe(0);
  });
  test("drafts, future-open and expired roles remain hidden and locale queries stay exact", async () => {
    const created = await createCareerOpening(editor, draft("scheduled"), null);
    const now = new Date();
    await db.careerOpening.update({ where: { id: created.id }, data: { status: "PUBLISHED", publishedAt: new Date(now.getTime() - 60000), opensAt: new Date(now.getTime() + 60000) } });
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en", now) } })).toBe(0);
    await db.careerOpening.update({ where: { id: created.id }, data: { opensAt: null, closesAt: new Date(now.getTime() - 1000) } });
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en", now) } })).toBe(0);
    await db.careerOpening.update({ where: { id: created.id }, data: { closesAt: null } });
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("ar", now) } })).toBe(0);
    expect(await db.careerOpening.count({ where: { id: created.id, ...publicCareerWhere("en", now) } })).toBe(1);
  });
  test("unsafe application links and invalid date ranges create no records", async () => {
    await expect(createCareerOpening(editor, { ...draft("unsafe"), applicationTarget: "javascript:alert(1)" }, null)).rejects.toMatchObject({ code: "CAREER_APPLICATION_INVALID" });
    await expect(createCareerOpening(editor, { ...draft("bad-dates"), opensAt: "2030-02-01T00:00:00.000Z", closesAt: "2030-01-01T00:00:00.000Z" }, null)).rejects.toMatchObject({ code: "CAREER_DATES_INVALID" });
    expect(await db.careerOpening.count({ where: { slug: `${prefix}-unsafe` } })).toBe(0);
  });
});

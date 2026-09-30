import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { createContentDraft, updateContentDraft, reviewContentEntry } from "@/server/domain/content-command";
import { GET as readContent } from "@/app/api/content/[type]/route";
import { resolveSpaRoutePage } from "@/server/seo/route-contract";
import { publicContentLocaleAlternates } from "@/server/seo/content-locale";

const prefix = `page-studio-${Date.now()}`;
const editor: SessionUser = { sessionId: `${prefix}-session`, id: `${prefix}-editor`, email: `${prefix}-editor@example.invalid`, name: "Page fixture", organizationId: null, roles: ["OWNER"], permissions: ["content:update"], mfaVerified: true };
const reviewer: SessionUser = { ...editor, id: `${prefix}-reviewer`, email: `${prefix}-reviewer@example.invalid`, roles: ["ADMIN"] };
beforeAll(async () => { for (const actor of [editor, reviewer]) await db.user.create({ data: { id: actor.id, email: actor.email } }); });
afterAll(async () => {
  const rows = await db.contentEntry.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  await db.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await db.contentEntry.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: [editor.id, reviewer.id] } } });
  await db.$disconnect();
});
const read = (type: string, slug: string, locale = "en") => readContent(new Request(`http://localhost/api/content/${type}?slug=${slug}&locale=${locale}`), { params: Promise.resolve({ type }) });

describe("Page Studio public contracts", () => {
  test("rejects a curated reference to a missing or unpublished entity", async () => {
    await expect(createContentDraft(editor, { contentType: "PAGE", locale: "en", slug: `${prefix}-private-ref`, title: "Private reference fixture", body: "", blocks: [{ type: "entity", entity: "property", slug: `${prefix}-missing-property`, label: "Fixture property" }] }, null)).rejects.toMatchObject({ code: "ENTITY_REFERENCE_INVALID" });
    expect(await db.contentEntry.count({ where: { slug: `${prefix}-private-ref` } })).toBe(0);
  });
  test("published PAGE records resolve by API type and keep the requested locale exact", async () => {
    const created = await createContentDraft(editor, { contentType: "PAGE", locale: "en", slug: `${prefix}-page`, title: "Synthetic managed page", body: "", blocks: [{ type: "module", id: "property-search" }] }, null);
    expect((await read("pages", `${prefix}-page`)).status).toBe(404);
    let current = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const submitted = await updateContentDraft(editor, { contentEntryId: created.id, expectedUpdatedAt: current.updatedAt.toISOString(), slug: current.slug, title: current.title, body: current.body, submitForReview: true }, null);
    const approved = await reviewContentEntry(reviewer, created.id, submitted.updatedAt, "APPROVE", "Fixture reviewed", null);
    await reviewContentEntry(reviewer, created.id, approved.updatedAt, "PUBLISH", "", null);
    const response = await read("pages", `${prefix}-page`);
    expect(response.status).toBe(200);
    expect((await response.json()).entry.contentType).toBe("PAGE");
    expect((await read("pages", `${prefix}-page`, "ar")).status).toBe(404);
    expect(await resolveSpaRoutePage(`/pages/${prefix}-page`, "ar")).toBeNull();
    current = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect((await db.contentRevision.findFirstOrThrow({ where: { contentEntryId: created.id, version: 1 } })).snapshotJson).toContain("property-search");
    expect(current.status).toBe("PUBLISHED");
  });
  test("international guidance needs a current source for review, publication and public reads", async () => {
    const slug = `${prefix}-international`;
    const created = await createContentDraft(editor, { contentType: "INTERNATIONAL_GUIDE", locale: "en", slug, title: "Synthetic source-reviewed guide", body: "Fixture text only" }, null);
    let current = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    await expect(updateContentDraft(editor, { contentEntryId: created.id, expectedUpdatedAt: current.updatedAt.toISOString(), slug, title: current.title, body: current.body, submitForReview: true }, null)).rejects.toMatchObject({ code: "INTERNATIONAL_SOURCE_REQUIRED" });
    const submitted = await updateContentDraft(editor, { contentEntryId: created.id, expectedUpdatedAt: current.updatedAt.toISOString(), slug, title: current.title, body: current.body, submitForReview: true, sourceName: "Synthetic source", sourceUrl: "https://example.invalid/source", sourceVerifiedAt: new Date(Date.now() - 60000).toISOString(), freshnessReviewDueAt: new Date(Date.now() + 86400000).toISOString() }, null);
    const approved = await reviewContentEntry(reviewer, created.id, submitted.updatedAt, "APPROVE", "Verified fixture", null);
    await reviewContentEntry(reviewer, created.id, approved.updatedAt, "PUBLISH", "", null);
    expect((await read("international", slug)).status).toBe(200);
    await db.contentEntry.update({ where: { id: created.id }, data: { freshnessReviewDueAt: new Date(Date.now() - 1000) } });
    expect((await read("international", slug)).status).toBe(404);
    current = await db.contentEntry.findUniqueOrThrow({ where: { id: created.id } });
    const now = new Date();
    const member = { locale: "en", slug, status: "PUBLISHED", publishedAt: new Date(now.getTime() - 60000), sourceName: "Fixture", sourceUrl: "https://example.invalid", sourceVerifiedAt: new Date(now.getTime() - 60000), freshnessReviewDueAt: new Date(now.getTime() + 60000) };
    expect(publicContentLocaleAlternates("international", [member, { ...member, locale: "ar", freshnessReviewDueAt: current.freshnessReviewDueAt }], now)).toBeNull();
  });
});

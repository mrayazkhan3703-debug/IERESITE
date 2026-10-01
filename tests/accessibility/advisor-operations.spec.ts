import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
const db = new PrismaClient(), prefix = `advisor-browser-${Date.now()}`, userId = prefix + "-owner", sourceId = prefix + "-source", documentId = prefix + "-doc";
const token = randomBytes(32).toString("hex"), baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1", "web", "web-test"].includes(new URL(baseURL).hostname) || !["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Advisor browser verification requires the disposable stack.");
  const role = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await db.user.create({ data: { id: userId, email: userId + "@example.invalid", emailVerified: new Date(), roles: { create: { roleId: role.id } } } });
  await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
  await db.ragSource.create({ data: { id: sourceId, title: prefix, sourceType: "INTERNAL_DOC", trustTier: "INTERNAL", isActive: true, isApproved: true, approvedById: userId, approvedAt: new Date(), verifiedAt: new Date(Date.now() - 60000), freshnessReviewDueAt: new Date(Date.now() + 86400000) } });
  const content = "Synthetic disposable browser indexing verification. No property facts or customer data are included in this test document.";
  await db.ragDocument.create({ data: { id: documentId, sourceId, title: prefix + " reviewed document", slug: documentId, content, contentHash: createHash("sha256").update(content).digest("hex"), status: "ACTIVE", approvedById: userId, approvedAt: new Date() } });
});
test.afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.ragDocument.deleteMany({ where: { id: documentId } }); await db.ragSource.deleteMany({ where: { id: sourceId } });
  await db.session.deleteMany({ where: { userId } }); await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect();
});
for (const locale of ["en", "ar"] as const) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`${locale} ${size}: advisor readiness, reviewed indexing and CRM deferral`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.context().addCookies([{ name: "ie_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await db.ragChunk.deleteMany({ where: { documentId } });
    const root = locale === "ar" ? "/ar" : "";
    await page.goto(root + "/admin/knowledge-base");
    const panel = page.getByRole("region", { name: "Advisor readiness and knowledge indexing" });
    await expect(panel).toContainText("BLOCKED"); await expect(panel).toContainText("AI_KILL_SWITCH"); await expect(panel).toContainText("CURRENT_REVISION_NOT_INDEXED");
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/rag/index" && response.request().method() === "POST");
    await panel.getByRole("button", { name: "Index up to 10 approved revisions", exact: true }).click();
    expect((await pending).status()).toBe(200);
    await expect(panel.getByRole("listitem").filter({ hasText: prefix + " reviewed document" })).toContainText("READY");
    expect(await db.ragChunk.count({ where: { documentId, documentVersion: 1 } })).toBeGreaterThan(0);
    if (locale === "en" && size === "desktop") {
      await panel.getByRole("button", { name: "Verify selected provider", exact: true }).click();
      await expect(panel.getByRole("status")).toContainText("AI_KILL_SWITCH");
    }
    expect((await new AxeBuilder({ page }).include('[aria-label="Advisor readiness and knowledge indexing"]').analyze()).violations).toEqual([]);
    await page.goto(root + "/admin/crm");
    await expect(page.getByText("CRM sync: Deferred.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GHL", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

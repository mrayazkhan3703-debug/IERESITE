import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
const db = new PrismaClient(), prefix = `measurement-browser-${Date.now()}`, userId = prefix + "-analyst", orgId = prefix + "-org";
const token = randomBytes(32).toString("hex"), baseURL = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3000";
test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1", "web", "web-test"].includes(new URL(baseURL).hostname) || !["db", "postgres", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Measurement journeys require the disposable stack.");
  await db.organization.create({ data: { id: orgId, name: "Disposable measurement verification", slug: orgId } });
  const role = await db.role.findUniqueOrThrow({ where: { key: "ANALYST" } });
  await db.user.create({ data: { id: userId, email: userId + "@example.invalid", emailVerified: new Date(), organizationId: orgId, roles: { create: { roleId: role.id } } } });
  await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
});
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } }); await db.organization.deleteMany({ where: { id: orgId } }); await db.$disconnect();
});
for (const locale of ["en", "ar"] as const) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`${locale} ${size}: analytics and quality report measured limits accessibly`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.context().addCookies([{ name: "ie_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const root = locale === "ar" ? "/ar" : "";
    await page.goto(root + "/admin/analytics");
    const analytics = page.getByRole("region", { name: "Analytics measurement" });
    await expect(analytics).toContainText("Measured"); await expect(analytics).toContainText("not total visits");
    await expect(analytics).toContainText("your organization");
    expect((await new AxeBuilder({ page }).include('[aria-label="Analytics measurement"]').analyze()).violations).toEqual([]);
    await page.goto(root + "/admin/data-quality");
    const quality = page.getByRole("region", { name: "Data quality scan coverage" });
    await expect(quality).toContainText("evaluated"); await expect(quality).toContainText("stored"); await expect(quality).toContainText("do not prove source verification");
    expect((await new AxeBuilder({ page }).include('[aria-label="Data quality scan coverage"]').analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

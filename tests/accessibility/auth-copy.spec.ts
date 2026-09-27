import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { t } from "../../src/lib/i18n";

for (const locale of ["en", "ar"] as const) {
  for (const mode of ["login", "register"] as const) {
    test(`localized auth labels and reset acceptance: ${locale} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${locale === "ar" ? "/ar" : ""}/account/${mode}`, { waitUntil: "networkidle" });
      const heading = locale === "ar"
        ? mode === "login" ? "تسجيل الدخول إلى حسابك" : "إنشاء حسابك"
        : mode === "login" ? "Sign in to your account" : "Create your account";
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.getByLabel(t("auth.email", locale), { exact: true })).toHaveAttribute("dir", "ltr");
      await expect(page.getByLabel(t("auth.password", locale), { exact: true })).toBeVisible();
      if (mode === "register") {
        await expect(page.getByLabel(t("auth.fullName", locale), { exact: true })).toBeVisible();
        await expect(page.getByText(t("auth.passwordHint", locale), { exact: true })).toBeVisible();
      }
      const audit = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(audit.violations).toEqual([]);
      if (mode !== "login") return;

      let resetRequests = 0;
      let resetStatus = 202;
      let accepted = true;
      await page.route("**/api/auth/forgot-password", async (route) => {
        resetRequests++;
        await route.fulfill({ status: resetStatus, contentType: "application/json", body: JSON.stringify(resetStatus === 202 ? { accepted } : { code: "RATE_LIMITED", error: "synthetic internal detail" }) });
      });
      await page.getByRole("button", { name: t("auth.forgotPassword", locale), exact: true }).click();
      await expect(page.locator("#main-content").getByRole("alert")).toHaveText(t("auth.enterEmail", locale));
      expect(resetRequests).toBe(0);
      await page.getByLabel(t("auth.email", locale), { exact: true }).fill("iere-auth-local@example.invalid");
      await page.getByRole("button", { name: t("auth.forgotPassword", locale), exact: true }).click();
      await expect(page.getByText(t("auth.resetAccepted", locale), { exact: true })).toBeVisible();
      expect(resetRequests).toBe(1);
      resetStatus = 429;
      await page.getByRole("button", { name: t("auth.forgotPassword", locale), exact: true }).click();
      await expect(page.locator("#main-content").getByRole("alert")).toHaveText(t("auth.rateLimited", locale));
      await expect(page.getByText(t("auth.resetAccepted", locale), { exact: true })).toHaveCount(0);
      expect(resetRequests).toBe(2);
      resetStatus = 202;
      accepted = false;
      await page.getByRole("button", { name: t("auth.forgotPassword", locale), exact: true }).click();
      await expect(page.locator("#main-content").getByRole("alert")).toHaveText(t("auth.failed", locale));
      await expect(page.getByText(t("auth.resetAccepted", locale), { exact: true })).toHaveCount(0);
      expect(resetRequests).toBe(3);
    });
  }
}

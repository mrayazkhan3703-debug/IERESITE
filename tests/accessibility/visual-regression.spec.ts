import { expect, test } from "./fixtures";

// These static forms contain no property/provider/user records. Keep viewport,
// locale, fonts and browser image pinned to make the baselines repeatable.
test.use({ locale: "en-GB", timezoneId: "UTC", colorScheme: "light", contextOptions: { reducedMotion: "reduce" } });

for (const locale of ["en", "ar"] as const) {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`visual sign-in layout: ${locale} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(locale === "ar" ? "/ar/account/login" : "/account/login", { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.locator("#main-content input[type=email]")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      await expect(page.locator("#main-content")).toHaveScreenshot(`signin-${locale}-${viewport.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.001,
        // The baseline covers the form/main layout; external fixed overlays
        // (consent and mobile navigation) must not occlude it during capture.
        stylePath: "tests/accessibility/visual-overlays.css",
      });
    });
  }
}

for (const locale of ["en", "ar"] as const) {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`visual registration layout: ${locale} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(locale === "ar" ? "/ar/account/register" : "/account/register", { waitUntil: "networkidle" });
      await expect(page.locator("#main-content input[type=email]")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("#main-content")).toHaveScreenshot(`register-${locale}-${viewport.name}.png`, {
        animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.001, stylePath: "tests/accessibility/visual-overlays.css",
      });
    });
    test(`visual ROI layout: ${locale} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(locale === "ar" ? "/ar/calculators/roi" : "/calculators/roi", { waitUntil: "networkidle" });
      await expect(page.locator("#roi-price")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("#main-content")).toHaveScreenshot(`roi-${locale}-${viewport.name}.png`, {
        animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.001, stylePath: "tests/accessibility/visual-overlays.css",
      });
    });
  }
}

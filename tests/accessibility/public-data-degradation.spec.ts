import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
for (const locale of ["en", "ar"] as const) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`${locale} ${size}: home reports unavailable metrics and keeps independent public feeds`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/market/metrics?latest=1", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Disposable unavailable metrics"}' }));
    await page.goto(locale === "ar" ? "/ar" : "/");
    const status = page.getByRole("status").filter({ hasText: locale === "ar" ? "بعض البيانات غير متاحة" : "Some data is temporarily unavailable" });
    await expect(status).toBeVisible();
    await expect(page.getByRole("link", { name: locale === "ar" ? "الفرص" : "Opportunities", exact: true })).toHaveAttribute("href", locale === "ar" ? "/ar/invest/opportunities" : "/invest/opportunities");
    await expect(page.locator("#pulse-heading").locator("..", {}).locator("..", {})).not.toContainText("Loading");
    const demo = page.locator('[aria-labelledby="aidemo-heading"]');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toContainText(locale === "ar" ? "لا يوجد مصدر مقياس متاح" : "No metric source available");
    await expect(demo).not.toContainText("Downtown trades at a higher");
    await expect(demo.getByRole("region")).toHaveAttribute("tabindex", "0");
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="aidemo-heading"]').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

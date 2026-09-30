import { expect, test } from "./fixtures";

for (const route of ["/", "/ar"]) {
  test(`saved Scenario Lab restores after hydration without overwriting storage: ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|React error #418/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => {
      const key = "ie_scenario_lab_v2";
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify({
        budget: 1700000, monthlyRent: 11000, financing: "cash", horizon: 5, propertyType: "villa",
      }));
    });
    await page.goto(route);
    await expect(page.locator("#scenario-budget")).toHaveValue("1700000");
    await expect(page.locator("#scenario-rent")).toHaveValue("11000");
    await page.locator("#scenario-budget").fill("2000000");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("ie_scenario_lab_v2")!).budget)).toBe(2000000);
    await page.reload();
    await expect(page.locator("#scenario-budget")).toHaveValue("2000000");
    await expect(page.locator("#scenario-rent")).toHaveValue("11000");
    expect(errors).toEqual([]);
  });
}

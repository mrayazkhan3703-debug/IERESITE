import { expect, test } from "./fixtures";

test("slow initial status cannot restore grants after essential-only choice", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let initialRequested!: () => void;
  const initial = new Promise<void>((resolve) => { initialRequested = resolve; });
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/analytics/consent", async (route) => {
    if (route.request().method() === "GET") {
      initialRequested();
      await pending;
      await route.fulfill({ json: { decided: true, analytics: true, marketing: true, personalization: true } });
    } else {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { recorded: 3 } });
    }
  });
  await page.goto("/account/login", { waitUntil: "domcontentloaded" });
  await initial;
  await page.getByRole("button", { name: "Essential only", exact: true }).click();
  await expect(page.locator("[data-consent-banner]")).toHaveCount(0);
  const statusResponse = page.waitForResponse((response) => response.url().endsWith("/api/analytics/consent") && response.request().method() === "GET");
  release();
  await statusResponse;
  expect(submitted).toMatchObject({ essential: true, analytics: false, marketing: false, personalization: false });
  expect(await page.evaluate(() => localStorage.getItem("ie_attr"))).toBeNull();
  await expect(page.locator("[data-consent-banner]")).toHaveCount(0);
});

test("failed choice save remains visible and shows truthful disabled-analytics notice", async ({ page }) => {
  await page.route("**/api/analytics/consent", (route) => route.fulfill({
    status: route.request().method() === "POST" ? 503 : 200,
    json: route.request().method() === "POST" ? { error: "synthetic unavailable" }
      : { decided: false, analytics: false, marketing: false, personalization: false },
  }));
  await page.goto("/account/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(page.locator("[data-consent-banner]")).toBeVisible();
  await expect(page.locator("[data-consent-banner]").getByRole("alert")).toContainText("Non-essential analytics remain disabled");
  expect(await page.evaluate(() => localStorage.getItem("ie_attr"))).toBeNull();
});

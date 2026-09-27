import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { calculatorCopy } from "../../src/lib/calculator-copy";
import { CALCULATOR_TOOLS } from "../../src/lib/calculator-tools";
import { journeyCopy } from "../../src/lib/journey-copy";

test.beforeEach(async ({ page }) => {
  // Read-only mocked consent status for these focused UI tests. No grants.
  await page.route("**/api/analytics/consent", (route) => route.fulfill({ json: {
    decided: true, analytics: false, marketing: false, personalization: false,
  } }));
});

for (const locale of ["en", "ar"] as const) {
  test(`five calculator controls and automated axe: ${locale}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const c = calculatorCopy(locale);
    for (const tool of CALCULATOR_TOOLS) {
      await page.goto(`${locale === "ar" ? "/ar" : ""}/calculators/${tool.key}`, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.getByRole("heading", { name: c(tool.title), exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: c("Calculator tools") })).toBeVisible();
      for (const input of await page.locator('#main-content input[type="number"]').all()) {
        expect(await input.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const result = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations).toEqual([]);
    }
  });
}

test("ROI numbers are identical across locales and scenario/input controls still recalculate", async ({ page }) => {
  let englishValues: string[] = [];
  for (const locale of ["en", "ar"] as const) {
    const c = calculatorCopy(locale);
    await page.goto(`${locale === "ar" ? "/ar" : ""}/calculators/roi`, { waitUntil: "networkidle" });
    const cards = page.locator('div.grid > div').filter({ has: page.locator('p[title]') });
    const allValues = await cards.locator('p[title]').allTextContents();
    expect(allValues.length).toBeGreaterThanOrEqual(6);
    // Year/beyond labels are localized; the five monetary/percentage outputs aren't.
    const values = allValues.slice(0, 5);
    if (locale === "en") englishValues = values;
    else expect(values).toEqual(englishValues);
    const upside = page.getByRole("tab", { name: new RegExp(`^${c("Upside")}`) });
    await upside.click();
    await expect(upside).toHaveAttribute("aria-selected", "true");
    expect((await cards.locator('p[title]').allTextContents()).slice(0, 5)).not.toEqual(values);
    await page.getByLabel(c("Purchase price (AED)"), { exact: true }).fill("1900000");
    await expect(page.locator("#roi-price")).toHaveValue("1900000");
    await expect(page.getByText(c("projection, not a guarantee"), { exact: true })).toBeVisible();
  }
});

test("Arabic payment-plan editor validates, reorders, and preserves user-written stage names", async ({ page }) => {
  const c = calculatorCopy("ar");
  await page.goto("/ar/calculators/payment-plan", { waitUntil: "networkidle" });
  const custom = "مرحلة اختبار المستخدم";
  await page.getByRole("textbox", { name: `${c("Stage")} 1 ${c("label")}`, exact: true }).fill(custom);
  await page.getByRole("spinbutton", { name: `${c("Stage")} 1 ${c("percent")}`, exact: true }).fill("5");
  await expect(page.locator("#main-content").getByRole("alert")).toContainText(c("Each stage must be between 0% and 100%; the total must equal 100% within ±0.01%."));
  await page.getByRole("spinbutton", { name: `${c("Stage")} 1 ${c("percent")}`, exact: true }).fill("10");
  await expect(page.locator("#main-content").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: `${c("Move stage")} 1 ${c("down")}`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: `${c("Stage")} 2 ${c("label")}`, exact: true })).toHaveValue(custom);
  await expect(page.getByText(c("At booking"), { exact: true })).toBeVisible();
});

test("FAQ sends the selected locale and retains explicitly synthetic source text", async ({ page }) => {
  const locales: string[] = [];
  await page.route("**/api/content/faqs?**", (route) => {
    locales.push(new URL(route.request().url()).searchParams.get("locale") ?? "");
    return route.fulfill({ json: { faqs: [{ id: "synthetic-faq", groupKey: "BUYING", question: "سؤال اختبار اصطناعي", answer: "إجابة اختبار اصطناعية." }] } });
  });
  await page.goto("/ar/faq", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: journeyCopy("ar").faq.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "سؤال اختبار اصطناعي" }).click();
  await expect(page.getByText("إجابة اختبار اصطناعية.", { exact: true })).toBeVisible();
  expect(locales).toEqual(["ar"]);
});

for (const status of ["REQUESTED", "CONFIRMED"] as const) {
  test(`Arabic consultation UI reflects mocked status ${status}, not fabricated availability`, async ({ page }) => {
    const copy = journeyCopy("ar").consultation;
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/consultations", (route) => {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { reference: "SYNTHETIC-LEAD", duplicate: false,
        booking: { reference: "SYNTHETIC-BOOKING", created: true, status, scheduledAt: String(submitted.scheduledAt) } } });
    });
    await page.goto("/ar/consultation", { waitUntil: "networkidle" });
    await page.getByRole("radiogroup", { name: copy.date }).getByRole("radio").first().click();
    await page.getByRole("radiogroup", { name: copy.time }).getByRole("radio").first().click();
    await page.getByLabel(copy.fullName).fill("اختبار اصطناعي");
    await page.getByLabel(copy.phone, { exact: true }).fill("+971500000001");
    await page.getByLabel(copy.email, { exact: true }).fill("synthetic-ui@example.invalid");
    await expect(page.locator("#c-phone")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#c-email")).toHaveAttribute("dir", "ltr");
    await page.getByLabel(copy.contact).check();
    await expect(page.getByLabel(copy.marketing)).not.toBeChecked();
    await page.getByRole("button", { name: copy.submit }).click();
    await expect(page.getByRole("heading", { name: status === "CONFIRMED" ? copy.confirmed : copy.received })).toBeVisible();
    await expect(page.getByRole("status")).toContainText(status === "CONFIRMED" ? copy.confirmedNote : copy.requestNote);
    await expect(page.locator('bdi[dir="ltr"]').filter({ hasText: "SYNTHETIC-BOOKING" })).toBeVisible();
    expect(submitted?.preferredLocale).toBe("ar");
    expect(submitted?.consentContact).toBe(true);
    expect(submitted?.consentMarketing).toBe(false);
    expect(String(submitted?.scheduledAt)).toMatch(/T05:30:00\.000Z$/);
  });
}

test.describe("critical cold deep links without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const route of ["/buy", "/calculators/roi", "/consultation", "/account/login", "/ar/calculators/roi"]) {
    test(`visible server-rendered main content: ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator("#main-content h1")).toBeVisible();
      await expect(page.locator("[data-consent-banner]")).toBeVisible();
    });
  }
});

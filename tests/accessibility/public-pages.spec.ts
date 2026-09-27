import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const pages = [
  { path: "/", lang: "en", dir: "ltr" },
  { path: "/ar", lang: "ar", dir: "rtl" },
  { path: "/about", lang: "en", dir: "ltr" },
  { path: "/ar/about", lang: "ar", dir: "rtl" },
  { path: "/buy", lang: "en", dir: "ltr" },
  { path: "/ar/buy", lang: "ar", dir: "rtl" },
  { path: "/consultation", lang: "en", dir: "ltr" },
  { path: "/ar/consultation", lang: "ar", dir: "rtl" },
  { path: "/calculators/roi", lang: "en", dir: "ltr" },
  { path: "/ar/calculators/roi", lang: "ar", dir: "rtl" },
];

for (const route of pages) {
  test(`axe WCAG 2.1 A/AA: ${route.path}`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: "networkidle" });
    expect(response?.status(), `HTTP status for ${route.path}`).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", route.lang);
    await expect(page.locator("html")).toHaveAttribute("dir", route.dir);
    await expect(page.getByRole("main").first()).toBeAttached();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, summary: node.failureSummary })),
    }));
    if (violations.length > 0) throw new Error(`axe violations on ${route.path}: ${JSON.stringify(violations)}`);
  });
}

for (const locale of [
  { path: "/about", skipText: /skip to main/i },
  { path: "/ar/about", skipText: /تخطَّ إلى المحتوى الرئيسي/ },
]) {
  test(`keyboard skip link: ${locale.path}`, async ({ page }) => {
    await page.goto(locale.path, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toContainText(locale.skipText);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator("#main-content")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.querySelector("#main-content")?.contains(document.activeElement))).toBe(true);
  });
}

for (const path of ["/consultation", "/ar/consultation", "/calculators/roi", "/ar/calculators/roi"]) {
  test(`mobile reflow does not overflow the viewport: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto(path, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => {
      const width = window.innerWidth;
      const offenders = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
        .map((element) => ({
          tag: element.tagName,
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
          scrollWidth: element.scrollWidth,
        }))
        .filter((element) => element.right > width + 1 || element.left < -1)
        .slice(0, 8);
      return { pageWidth: document.documentElement.scrollWidth, viewportWidth: width, scrollX: window.scrollX, offenders };
    });
    expect(overflow.pageWidth <= overflow.viewportWidth, `Unexpected page-level horizontal overflow at ${path}: ${JSON.stringify(overflow)}`).toBe(true);
  });
}

test("ROI chart exposes a non-visual summary", async ({ page }) => {
  await page.goto("/calculators/roi", { waitUntil: "networkidle" });
  await expect(page.getByRole("img", { name: /Stacked area chart of cumulative rental income and capital appreciation by year/ })).toBeAttached();
});

test("home LCP hero uses responsive optimized image output", async ({ page }) => {
  let heroResponseContentType: string | undefined;
  page.on("response", (response) => {
    if (response.url().includes("/_next/image?") && response.url().includes("hero-skyline.jpg")) {
      heroResponseContentType = response.headers()["content-type"];
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const hero = page.getByRole("img", { name: "Dubai skyline at dusk across the water" });
  await expect(hero).toHaveAttribute("src", /\/_next\/image\?url=/);
  await expect(hero).toHaveAttribute("srcset", /\/_next\/image/);
  await expect.poll(() => heroResponseContentType).toBe("image/webp");
  await expect.poll(() => hero.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("home navigation reaches Buy search with the requested query", async ({ page }) => {
  const homeResponse = await page.goto("/", { waitUntil: "networkidle" });
  expect(homeResponse?.status()).toBe(200);

  const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
  await primaryNavigation.getByRole("button", { name: "Properties", exact: true }).click();
  await primaryNavigation.getByRole("link", { name: "Buy", exact: true }).click();
  await expect(page).toHaveURL(/\/buy$/);

  await page.getByRole("searchbox", { name: /search by community/i }).fill("Dubai");
  const searchResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/search?") && response.request().method() === "GET"
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(/\/properties\?q=Dubai/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dubai");
  expect((await searchResponsePromise).status()).toBe(200);
});

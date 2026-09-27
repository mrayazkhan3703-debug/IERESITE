import { expect, test } from "./fixtures";

test("locale switch keeps the native destination and query without double prefixes", async ({ page }) => {
  await page.goto("/about?context=SYNTHETIC");
  await page.getByRole("button", { name: "Switch language", exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/about\?context=SYNTHETIC$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator('main a[href="/ar/about/team"]').first()).toBeVisible();
  await page.getByRole("button", { name: "تغيير اللغة", exact: true }).click();
  await expect(page).toHaveURL(/\/about\?context=SYNTHETIC$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('main a[href="/about/team"]').first()).toBeVisible();
});

for (const prefix of ["", "/ar"]) {
  test(`native cross-route links and back/forward preserve locale without document reload: ${prefix || "en"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${prefix}/about`);
    await expect(page.locator('main a[href="' + prefix + '/about/team"]').first()).toBeVisible();
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__nativeSentinel = "same-document"; });
    await page.locator('main a[href="' + prefix + '/about/team"]').first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/about/team$`));
    // Wait for the actual destination, not the still-visible previous heading
    // while native routing commits its asynchronous flight/chunk transition.
    await expect(page.locator('main a[href="' + prefix + '/about/team"]').first()).toHaveCount(0);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__nativeSentinel)).toBe("same-document");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${prefix}/about$`));
    await expect(page.locator('main a[href="' + prefix + '/about/team"]').first()).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${prefix}/about/team$`));
    await expect(page.locator('main a[href="' + prefix + '/about/team"]').first()).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__nativeSentinel)).toBe("same-document");
    await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "ar" : "en");
    await expect(page.locator("html")).toHaveAttribute("dir", prefix ? "rtl" : "ltr");
    expect(errors).toEqual([]);
  });
}

test("native routing rejects unknown and unpublished entity destinations", async ({ page }) => {
  for (const path of ["/not-an-iere-route", "/projects/not-a-public-iere-project", "/ar/projects/not-a-public-iere-project", "/ar/calculators/not-an-iere-tool"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    // Next adds its own boundary noindex alongside the explicit 404 metadata.
    await expect.poll(() => page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.length > 0 && nodes.every((node) => /noindex/.test(node.getAttribute("content") ?? "")))).toBe(true);
  }
});

test("legacy hash bookmark requests a native route and keeps locale", async ({ page }) => {
  await page.goto("/#/ar/about/team");
  await expect(page).toHaveURL(/\/ar\/about\/team$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("main h1")).toBeVisible();
});

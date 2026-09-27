import { expect, test } from "bun:test";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web-test:3000";
const origin = new URL(baseUrl);
if (origin.protocol !== "http:" || origin.username || origin.password ||
  !["web-test", "web", "localhost", "127.0.0.1", "host.docker.internal"].includes(origin.hostname)) {
  throw new Error("Critical-route tests require an explicitly local test server");
}

const routes = ["/", "/buy", "/consultation", "/account/login", "/account/register", "/faq", "/calculators",
  ...["roi", "yield", "mortgage", "payment-plan", "currency"].map((tool) => `/calculators/${tool}`)];
const localizedPath = (path: string, locale: string) => locale === "ar" ? `/ar${path === "/" ? "" : path}` : path;
const publicUrl = (path: string) => `http://localhost:3000${path === "/" ? "" : path}`;

for (const locale of ["en", "ar"] as const) {
  test(`concrete critical routes retain server SEO contracts: ${locale}`, async () => {
    for (const route of routes) {
      const path = localizedPath(route, locale);
      const response = await fetch(`${baseUrl}${path}`);
      const html = await response.text();
      expect(response.status).toBe(200);
      // Boolean checks keep failed assertions from dumping entire rendered pages.
      expect(html.includes(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`)).toBe(true);
      expect(html.includes(`rel="canonical" href="${publicUrl(path)}"`)).toBe(true);
      const privatePage = route.startsWith("/account/");
      expect(html.includes(`name="robots" content="${privatePage ? "noindex, nofollow" : "index, follow"}"`)).toBe(true);
      if (!privatePage) {
        expect(html.includes(`hrefLang="en" href="${publicUrl(route)}"`)).toBe(true);
        expect(html.includes(`hrefLang="ar" href="${publicUrl(localizedPath(route, "ar"))}"`)).toBe(true);
      }
    }
  });

  test(`concrete calculator boundary rejects unknown tools: ${locale}`, async () => {
    const response = await fetch(`${baseUrl}${localizedPath("/calculators/not-an-iere-tool", locale)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("noindex");
  });
}

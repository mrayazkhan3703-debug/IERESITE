import { describe, expect, test } from "bun:test";
import { escapeSitemapXml } from "@/server/seo/sitemap";
import { robotsForEnvironment, robotsTextForEnvironment } from "@/server/seo/staging-robots";

describe("staging crawler exclusion", () => {
  test("both public robots endpoints disallow the entire staging site", () => {
    expect(robotsForEnvironment("staging", "https://staging.example.test")).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
    expect(robotsTextForEnvironment("staging", "https://staging.example.test"))
      .toBe("User-agent: *\nDisallow: /\n");
  });
});


test("production crawler rules cover private roots and localized roots consistently", () => {
  const metadata = robotsForEnvironment("production", "https://example.test");
  const text = robotsTextForEnvironment("production", "https://example.test");
  const rules = metadata.rules as { disallow: string[] };
  for (const path of ["/account", "/admin", "/ar/account", "/ar/admin", "/compare", "/api/"]) {
    expect(rules.disallow).toContain(path);
    expect(text).toContain(`Disallow: ${path}\n`);
  }
});


test("sitemap XML escapes attribute and text delimiters", () => {
  expect(escapeSitemapXml(`A&B<C>"'`)).toBe("A&amp;B&lt;C&gt;&quot;&apos;");
});

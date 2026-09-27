import { readFileSync, existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("native App Router extraction inventory", () => {
  test("every declared exact SEO route has concrete EN and AR modules", () => {
    const contract = readFileSync("src/server/seo/route-contract.ts", "utf8");
    const section = contract.split("const EXACT_ROUTES:")[1].split("const DYNAMIC_ROUTES:")[0];
    const routes = [...section.matchAll(/^  "([^"]+)":/gm)].map((match) => match[1]);
    expect(routes.length).toBeGreaterThan(40);
    for (const path of routes) {
      const tail = path === "/" ? "" : path;
      expect(existsSync(`src/app${tail}/page.tsx`)).toBe(true);
      expect(existsSync(`src/app/ar${tail}/page.tsx`)).toBe(true);
    }
  });
  test("entity, tool and admin patterns are concrete and client table is gone", () => {
    for (const tail of ["properties/[slug]", "projects/[slug]", "developers/[slug]", "communities/[slug]", "agents/[slug]", "market/reports/[slug]", "guides/[slug]", "international/[slug]", "insights/[slug]", "calculators/[tool]", "admin/[[...section]]"]) {
      for (const locale of ["", "ar/"]) expect(existsSync(`src/app/${locale}${tail}/page.tsx`)).toBe(true);
    }
    expect(existsSync("src/app/[...path]/page.tsx")).toBe(false);
    const shell = readFileSync("src/components/spa-root.tsx", "utf8");
    expect(/React\.lazy|matchRoute|STATIC_REDIRECTS|api\/seo\/redirects/.test(shell)).toBe(false);
  });
});

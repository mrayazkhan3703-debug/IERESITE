import { describe, expect, test } from "bun:test";
import { DEFAULT_SITE_SETTINGS, isPublicSitePath, parseSiteSettings, publicPageCopy } from "@/lib/site-settings";
import { parseContentBlocks } from "@/lib/content-blocks";
import { careerApplicationHref, validCareerApplication } from "@/lib/career-opening";

describe("governed public composition", () => {
  test("rejects private routes and normalization bypasses in navigation", () => {
    for (const path of ["/admin", "/ar/admin/content", "/account?next=/admin", "/api/health", "/content/../admin", "//example.invalid", "/%61dmin", "/a\\admin"]) expect(isPublicSitePath(path)).toBe(false);
    expect(isPublicSitePath("/pages/company-story")).toBe(true);
    expect(isPublicSitePath("/properties/map")).toBe(true);
  });
  test("old settings retain defaults while bilingual overrides stay bounded", () => {
    const { pageCopy: _copy, ...oldSettings } = DEFAULT_SITE_SETTINGS;
    const parsed = parseSiteSettings(oldSettings);
    expect(parsed).not.toBeNull();
    expect(publicPageCopy(parsed!, "homeTitle", "ar", "Built-in title")).toBe("Built-in title");
    const changed = structuredClone(DEFAULT_SITE_SETTINGS);
    changed.pageCopy.homeTitle = { en: "Our property desk", ar: "فريق العقارات" };
    expect(publicPageCopy(changed, "homeTitle", "ar", "fallback")).toBe("فريق العقارات");
    changed.pageCopy.homeTitle.ar = "";
    expect(parseSiteSettings(changed)).toBeNull();
  });
  test("cannot select arbitrary executable modules or repeat IDs", () => {
    expect(parseContentBlocks([{ type: "module", id: "arbitrary-script" }])).toBeNull();
    expect(parseContentBlocks([{ type: "module", id: "property-search" }, { type: "module", id: "property-search" }])).toBeNull();
    const unsafe = structuredClone(DEFAULT_SITE_SETTINGS);
    unsafe.headerGroups[0].items[0].to = "/ar/admin";
    expect(parseSiteSettings(unsafe)).toBeNull();
    expect(parseSiteSettings({ ...DEFAULT_SITE_SETTINGS, databasePassword: "not-allowed" })).toBeNull();
  });
  test("application destinations block executable URLs and preserve locale", () => {
    expect(validCareerApplication({ applicationMethod: "URL", applicationTarget: "javascript:alert(1)" })).toBe(false);
    expect(validCareerApplication({ applicationMethod: "URL", applicationTarget: "https://user:pass@example.invalid" })).toBe(false);
    expect(validCareerApplication({ applicationMethod: "EMAIL", applicationTarget: "hiring@example.invalid" })).toBe(true);
    expect(careerApplicationHref({ title: "Advisor", applicationMethod: "CONTACT", applicationTarget: null }, "ar")).toStartWith("/ar/contact?");
  });
});

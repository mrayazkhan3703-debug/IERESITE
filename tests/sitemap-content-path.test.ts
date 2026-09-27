import { describe, expect, it } from "bun:test";
import { contentSitemapPath } from "@/server/seo/sitemap-content-path";

describe("published content sitemap canonical paths", () => {
  it("maps both guide types to the route served by guide pages", () => {
    expect(contentSitemapPath("GUIDE", "buying-in-dubai")).toBe("/guides/buying-in-dubai");
    expect(contentSitemapPath("AREA_GUIDE", "downtown-dubai")).toBe("/guides/downtown-dubai");
  });

  it("maps articles to insights", () => {
    expect(contentSitemapPath("ARTICLE", "market-outlook")).toBe("/insights/market-outlook");
  });

  it("does not invent routes for non-page content", () => {
    expect(contentSitemapPath("LANDING", "home-campaign")).toBeNull();
    expect(contentSitemapPath("FAQ_GROUP", "general")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { publicContentLocaleAlternates } from "@/server/seo/content-locale";

const now = new Date("2026-09-23T00:00:00.000Z");

describe("published content locale metadata", () => {
  test("emits exact paired paths only when both translations are public", () => {
    const paths = publicContentLocaleAlternates("insights", [
      { locale: "en", slug: "market-outlook", status: "PUBLISHED", publishedAt: now },
      { locale: "ar", slug: "tahdid-al-suq", status: "PUBLISHED", publishedAt: now },
    ], now);
    expect(paths).toEqual({ en: "/insights/market-outlook", ar: "/ar/insights/tahdid-al-suq", "x-default": "/insights/market-outlook" });
  });

  test("does not advertise a draft, scheduled, unpaired, or unsafe path", () => {
    expect(publicContentLocaleAlternates("guides", [
      { locale: "en", slug: "guide-en", status: "PUBLISHED", publishedAt: now },
      { locale: "ar", slug: "guide-ar", status: "DRAFT", publishedAt: now },
    ], now)).toBeNull();
    expect(publicContentLocaleAlternates("guides", [
      { locale: "en", slug: "guide-en", status: "PUBLISHED", publishedAt: now },
    ], now)).toBeNull();
    expect(publicContentLocaleAlternates("../outside", [
      { locale: "en", slug: "guide-en", status: "PUBLISHED", publishedAt: now },
      { locale: "ar", slug: "guide-ar", status: "PUBLISHED", publishedAt: now },
    ], now)).toBeNull();
  });
});

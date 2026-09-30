import { describe, expect, test } from "bun:test";
import { formatDate } from "@/lib/money";

describe("shared date formatting", () => {
  for (const locale of ["en-AE", "ar-AE"]) test(`${locale} history presets work without conflicting component defaults`, () => {
    const date = new Date("2026-01-15T12:00:00Z");
    const options = { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" } as const;
    expect(formatDate(date, locale, options)).toBe(new Intl.DateTimeFormat(locale, options).format(date));
    expect(formatDate(date, locale, { timeStyle: "short" })).toBe(new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "Asia/Dubai" }).format(date));
    expect(formatDate(date, locale, { month: "long" })).toBe(new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Dubai" }).format(date));
  });
  test("missing and invalid dates remain unavailable", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("invalid-date", undefined, { dateStyle: "medium", timeStyle: "short" })).toBe("—");
  });
});

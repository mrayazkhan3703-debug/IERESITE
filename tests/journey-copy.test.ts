import { describe, expect, test } from "bun:test";
import { faqGroupLabel, journeyCopy, journeyDictionaries } from "../src/lib/journey-copy";

describe("localized journey copy", () => {
  test("Arabic has every non-empty UI key without substituting source content", () => {
    for (const section of ["faq", "consultation", "consent"] as const) {
      const english = journeyDictionaries.en[section];
      const arabic = journeyDictionaries.ar[section];
      expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort());
      for (const value of Object.values(arabic)) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value).toMatch(/[\u0600-\u06ff]/);
      }
    }
  });
  test("only allowlisted FAQ group codes select labels", () => {
    expect(faqGroupLabel("BUYING", "en")).toBe("Buying");
    expect(faqGroupLabel("BUYING", "ar")).toBe("الشراء");
    for (const key of ["__proto__", "title", "NEW_SOURCE_GROUP"]) {
      expect(faqGroupLabel(key, "ar")).toBe(journeyCopy("ar").faq.other);
    }
  });
  test("request and confirmed copy stay distinct and consent remains purpose-specific", () => {
    for (const locale of ["en", "ar"] as const) {
      const copy = journeyCopy(locale).consultation;
      expect(copy.received).not.toBe(copy.confirmed);
      expect(copy.requestNote).not.toBe(copy.confirmedNote);
      expect(copy.contact).not.toBe(copy.marketing);
    }
    expect(journeyCopy("en").consultation.requestNote).toContain("not a confirmed appointment");
    expect(journeyCopy("ar").consultation.requestNote).toContain("ليس موعداً مؤكداً");
  });
});

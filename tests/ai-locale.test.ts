import { describe, expect, it } from "bun:test";
import { advisorLocaleInstruction, extractArabicSearchCriteria, normalizeAdvisorLocale } from "@/server/ai/locale";
import { deterministicNlExtract } from "@/server/ai/advisor";
import { filtersToChips, filtersToRefineQuery } from "@/components/advisor/intent-format";
import { nlChipsFromFilters } from "@/components/search/search-bar";

describe("advisor locale and deterministic search evaluation", () => {
  it("preserves short-term criteria in English/Arabic chips and refined searches", () => {
    const criteria = { listingType: "SHORT_TERM" as const };
    expect(filtersToChips(criteria, "en")[0].label).toBe("Short-term rental");
    expect(filtersToChips(criteria, "ar")[0].label).toBe("إيجار قصير الأجل");
    expect(nlChipsFromFilters(criteria, [], "ar")[0]).toMatchObject({ param: "type", value: "short_term", applied: true, label: "إيجار قصير الأجل" });
    expect(deterministicNlExtract(filtersToRefineQuery(criteria), []).listingType).toBe("SHORT_TERM");
    expect(deterministicNlExtract("Find daily rentals", []).listingType).toBe("SHORT_TERM");
    expect(extractArabicSearchCriteria("ابحث عن شقة للإيجار قصير الأجل").listingType).toBe("SHORT_TERM");
    expect(extractArabicSearchCriteria("ابحث عن شقة للإيجار اليومي").listingType).toBe("SHORT_TERM");
    expect(extractArabicSearchCriteria("ابحث عن شقة للإيجار السنوي").listingType).toBe("RENT");
    expect(deterministicNlExtract("What is a short-term investment strategy?", []).listingType).toBeUndefined();
  });
  it("normalizes unknown locales and keeps source/entity values exact", () => {
    expect(normalizeAdvisorLocale("ar")).toBe("ar");
    expect(normalizeAdvisorLocale("fr")).toBe("en");
    expect(advisorLocaleInstruction("ar")).toContain("Modern Standard Arabic");
    expect(advisorLocaleInstruction("ar")).toContain("property/project/community names");
    expect(advisorLocaleInstruction("ar")).toContain("explain uncertainty in Arabic");
  });

  it("extracts only explicit Arabic criteria and normalizes Arabic-Indic numbers", () => {
    const filters = deterministicNlExtract(
      "ابحث عن شقة بغرفتي نوم للبيع بسعر أقل من ٢٫٥ مليون درهم في دبي مارينا",
      ["دبي مارينا", "وسط مدينة دبي"]
    );
    expect(filters).toMatchObject({
      bedroomsMin: 2,
      priceMax: 2_500_000,
      listingType: "SALE",
      communities: ["دبي مارينا"],
    });
  });

  it("does not turn an ambiguous small Arabic number into a property budget", () => {
    expect(extractArabicSearchCriteria("ابحث عن عقار تحت ٢ درهم")).not.toHaveProperty("priceMax");
  });

  it("interprets explicit Arabic-Indic bedroom and rent criteria without an AI call", () => {
    expect(deterministicNlExtract("شقة ٣ غرف نوم للإيجار على المخطط", [])).toMatchObject({
      bedroomsMin: 3,
      listingType: "RENT",
      offPlan: true,
    });
  });
});

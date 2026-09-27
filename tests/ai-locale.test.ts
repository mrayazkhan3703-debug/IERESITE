import { describe, expect, it } from "bun:test";
import { advisorLocaleInstruction, extractArabicSearchCriteria, normalizeAdvisorLocale } from "@/server/ai/locale";
import { deterministicNlExtract } from "@/server/ai/advisor";

describe("advisor locale and deterministic search evaluation", () => {
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

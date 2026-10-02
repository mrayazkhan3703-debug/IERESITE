import { expect, test } from "bun:test";
import { looksLikeSearchIntent } from "@/lib/advisor-search-intent";
import { NL_INTERPRETATION_SCOPE } from "@/server/ai/nl-interpretation-scope";

test("standalone English calculation scenarios do not call optional search parsing", () => {
  for (const text of ["For an illustrative purchase price of AED 2,000,000 and annual rent of AED 120,000, calculate gross yield.", "Calculate mortgage payment for AED 1M", "Compare two ROI calculation scenarios", "How is gross yield calculated?"]) expect(looksLikeSearchIntent(text, "en")).toBe(false);
});
test("standalone Arabic calculations do not call optional search parsing", () => {
  for (const text of ["احسب العائد لسعر مليوني درهم وإيجار سنوي 120 ألف", "أحسب قسط القرض بمبلغ مليون", "سيناريو شراء شقة بمليون درهم", "كيف يحسب العائد؟"]) expect(looksLikeSearchIntent(text, "ar")).toBe(false);
});
test("English searches with yield criteria and combined requests remain supported", () => {
  for (const text of ["Find 2 bedroom apartments with yield above 5%", "Search the current catalog for properties for sale", "Find an apartment under AED 2M and calculate its yield", "2 bedroom apartment under 2.5M", "Compare Downtown and Marina for an AED 3M investment"]) expect(looksLikeSearchIntent(text, "en")).toBe(true);
});
test("Arabic inventory searches and comparisons remain supported", () => {
  for (const text of ["ابحث عن شقة بعائد فوق 5%", "قارن دبي مارينا ووسط المدينة", "أبحث عن شقة ثم احسب عائدها", "شقة غرفتين تحت مليونين"]) expect(looksLikeSearchIntent(text, "ar")).toBe(true);
});
test("normal conversation and knowledge questions do not add filter chips", () => {
  for (const text of ["Hello", "What are the verified buyer fees?", "Explain your sources"]) expect(looksLikeSearchIntent(text, "en")).toBe(false);
});
test("NL prompt scopes explanations to criteria and preserves supported schema fields", () => {
  expect(NL_INTERPRETATION_SCOPE).toContain("ONLY to extract property search criteria");
  expect(NL_INTERPRETATION_SCOPE).toContain("Never claim that the application lacks");
  expect(NL_INTERPRETATION_SCOPE).toContain("only user-stated property preferences");
  for (const field of ["listingType", "communities", "priceMax", "yieldMinPct", "handoverBeforeQuarter"]) expect(NL_INTERPRETATION_SCOPE).toContain(field);
});

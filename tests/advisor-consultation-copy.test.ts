import { expect, test } from "bun:test";
import { dictionaries } from "@/lib/i18n";

test("English and Arabic Advisor instructions direct contact consent to the separate consultation form", () => {
  for (const locale of ["en", "ar"] as const) {
    const phrase = locale === "en" ? "consultation" : "استشار";
    for (const key of ["advisorV2.info.step4", "advisorV2.info.humanSub", "advisorV2.info.guard5"]) {
      expect(dictionaries[locale][key]).toContain(phrase);
    }
  }
  expect(dictionaries.en["advisorV2.info.humanSub"]).not.toContain("conversation context");
  expect(dictionaries.ar["advisorV2.info.humanSub"]).not.toContain("سياق محادثتك");
});

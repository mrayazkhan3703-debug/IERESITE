import { expect, test } from "bun:test";
import { calculatorArabic, calculatorCopy, paymentDueCopy } from "../src/lib/calculator-copy";
import { CALCULATOR_TOOLS } from "../src/lib/calculator-tools";

test("closed calculator UI vocabulary has Arabic labels and preserves English keys", () => {
  const english = calculatorCopy("en");
  const arabic = calculatorCopy("ar");
  for (const key of Object.keys(calculatorArabic) as (keyof typeof calculatorArabic)[]) {
    expect(english(key)).toBe(key);
    expect(arabic(key)).toMatch(/[\u0600-\u06ff]/);
  }
  for (const tool of CALCULATOR_TOOLS) {
    for (const key of [tool.title, tool.label, tool.blurb, ...tool.outputs]) {
      expect(arabic(key)).toBeTruthy();
    }
  }
});

test("due labels translate only known deterministic engine templates", () => {
  expect(paymentDueCopy("At booking", "ar")).toBe("عند الحجز");
  expect(paymentDueCopy("On plan order", "ar")).toBe("حسب ترتيب الخطة");
  expect(paymentDueCopy("Booking + 18 mo", "ar")).toBe("الحجز + 18 شهر");
  expect(paymentDueCopy("Booking + 18 mo", "en")).toBe("Booking + 18 mo");
  expect(paymentDueCopy("Custom provider milestone", "ar")).toBe("Custom provider milestone");
});

test("Arabic retains projection, indicative FX and unverified regulatory caveats", () => {
  const c = calculatorCopy("ar");
  expect(c("projection, not a guarantee")).toContain("ليس ضماناً");
  expect(c("Preset regulatory table, pending compliance re-verification; not currently effective law.")).toContain("لا يُعرض");
  expect(c("manually maintained, not live FX. Confirm with your bank before transactions.")).toContain("ليس سعر صرف مباشراً");
});

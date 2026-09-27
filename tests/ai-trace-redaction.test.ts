import { describe, expect, it } from "bun:test";
import {
  calculatorAssumptionSummary,
  redactAiToolTrace,
  safeHandoffProperties,
} from "@/server/ai/trace-redaction";

describe("AI tool trace redaction", () => {
  it("never persists lead or handoff arguments and results", () => {
    const secret = "private.person@example.test +971 50 123 4567";
    for (const toolName of ["capture_lead", "human_handoff"]) {
      const trace = redactAiToolTrace(toolName, { name: secret, email: secret, note: secret }, {
        ok: true,
        data: { reference: secret, note: secret },
      });
      expect(JSON.stringify(trace)).not.toContain(secret);
      expect(trace.input).toEqual({ redacted: true });
      expect(trace.output).toEqual({ redacted: true });
    }
  });

  it("keeps only calculator allowlists and removes labels, arbitrary fields, and dates", () => {
    const trace = redactAiToolTrace("calculate_payment_plan", {
      purchasePrice: 1_000_000,
      email: "private.person@example.test",
      stages: [
        { name: "Private buyer's booking", percent: 20, dueAt: { milestone: "private event detail" } },
        { name: "Construction", percent: 80, dueAt: { monthsFromBooking: 12, date: "2030-01-01" } },
      ],
    }, { ok: true, data: { private: "should not be stored" } });

    expect(trace.input).toEqual({
      purchasePrice: 1_000_000,
      stages: [{ percent: 20 }, { percent: 80, monthsFromBooking: 12 }],
    });
    expect(trace.output).toEqual({ redacted: true });
    expect(calculatorAssumptionSummary("calculate_payment_plan", trace.input))
      .toBe("purchasePrice=1000000, stages=20%/80%@12mo");
  });

  it("minimizes property handoff data and reconstructs same-origin URLs", () => {
    const trace = redactAiToolTrace("search_properties", { q: "private.person@example.test" }, {
      ok: true,
      data: {
        properties: [
          { slug: "marina-flat", title: "Marina Flat", community: "Dubai Marina", priceAed: 2_000_000, coverUrl: "https://private.test", ownerEmail: "private.person@example.test" },
          { slug: "contact-listing", title: "Call +971 50 123 4567", community: "Dubai Marina", priceAed: 1_000_000 },
          { slug: "unsafe/slug", title: "Ignored", community: "Dubai", priceAed: 1 },
        ],
      },
    });

    expect(trace.input).toEqual({ redacted: true });
    expect(trace.output).toEqual({ properties: [{
      slug: "marina-flat",
      title: "Marina Flat",
      community: "Dubai Marina",
      priceAed: 2_000_000,
      url: "/properties/marina-flat",
    }, {
      slug: "contact-listing",
      title: "",
      community: "Dubai Marina",
      priceAed: 1_000_000,
      url: "/properties/contact-listing",
    }] });
    expect(safeHandoffProperties({ properties: [{ slug: "legacy", title: "Old", community: "Dubai", priceAed: 1, url: "https://attacker.test" }] })[0]?.url)
      .toBe("/properties/legacy");
  });

  it("re-sanitizes calculator assumptions from legacy trace rows", () => {
    const summary = calculatorAssumptionSummary("calculate_mortgage", {
      propertyPrice: 750_000,
      borrowerCategory: "resident-first",
      email: "private.person@example.test",
      note: "my phone is +971 50 123 4567",
    });
    expect(summary).toBe("propertyPrice=750000, borrowerCategory=resident-first");
  });
});

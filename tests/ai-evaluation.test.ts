import { describe, expect, it } from "bun:test";
import { roiScenario, sourceCards } from "@/server/ai/attachments";
import { isDisabledAdvisorAction } from "@/server/ai/action-policy";

describe("fixed local advisor evaluations", () => {
  it("keeps citations tied to the exact supplied passage and source title", () => {
    const passage = "Synthetic approved guidance fixture; it makes no legal or market claim.";
    const [card] = sourceCards({ passages: [{
      content: passage,
      sourceTitle: "Synthetic approved source",
      trustTier: "OFFICIAL",
      verifiedAt: "2026-09-01T00:00:00.000Z",
      url: "/admin/knowledge/synthetic-source",
    }] });

    expect(card).toMatchObject({
      title: "Synthetic approved source",
      excerpt: passage,
      verifiedAt: "2026-09-01T00:00:00.000Z",
      url: "/admin/knowledge/synthetic-source",
    });
  });

  it("refuses to build an ROI scenario without the deterministic engine result", () => {
    expect(roiScenario({ purchasePrice: 1_000_000, annualRent: 70_000 })).toBeNull();
  });

  it("labels calculated projections as modeled and non-guaranteed", () => {
    const result = roiScenario({
      purchasePrice: 1_000_000,
      annualRent: 70_000,
      years: 5,
      scenarios: {
        downside: { netYieldPct: 4, totalReturn: 200_000, totalReturnPct: 20 },
        base: { netYieldPct: 5, totalReturn: 350_000, totalReturnPct: 35 },
        upside: { netYieldPct: 6, totalReturn: 500_000, totalReturnPct: 50 },
      },
    });

    expect(result).toMatchObject({
      purchasePriceAed: 1_000_000,
      annualRentAed: 70_000,
      horizonYears: 5,
      source: { state: "MODELED" },
    });
    expect(result?.source.note).toContain("not guaranteed returns");
  });

  it("keeps lead creation and human handoff disabled", () => {
    expect(isDisabledAdvisorAction("capture_lead")).toBe(true);
    expect(isDisabledAdvisorAction("human_handoff")).toBe(true);
  });
});

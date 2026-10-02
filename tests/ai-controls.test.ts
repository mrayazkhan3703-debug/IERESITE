import { describe, expect, it } from "bun:test";
import { aiBudgetDecision, aiProviderGateCode, estimateAiPromptCharacters, estimateAiReservationTokens } from "@/server/ai/controls";

describe("AI live-provider safety controls", () => {
  it("fails closed for external providers unless both operator gates permit Inception", () => {
    expect(aiProviderGateCode("inception", false, { isEnabled: true, rolloutPercent: 100 })).toBe("AI_LIVE_DISABLED");
    expect(aiProviderGateCode("inception", true, null)).toBe("AI_KILL_SWITCH");
    expect(aiProviderGateCode("inception", true, { isEnabled: false, rolloutPercent: 100 })).toBe("AI_KILL_SWITCH");
    expect(aiProviderGateCode("inception", true, { isEnabled: true, rolloutPercent: 99 })).toBe("AI_KILL_SWITCH");
    expect(aiProviderGateCode("zai", true, { isEnabled: true, rolloutPercent: 100 })).toBe("AI_PROVIDER_NOT_APPROVED");
    expect(aiProviderGateCode("inception", true, { isEnabled: true, rolloutPercent: 100 })).toBeNull();
    for (const legacy of ["gemini", "openai", "unknown"]) expect(aiProviderGateCode(legacy, true, { isEnabled: true, rolloutPercent: 100 })).toBe("AI_PROVIDER_NOT_APPROVED");
    expect(aiProviderGateCode("mock", false, { isEnabled: true, rolloutPercent: 100 })).toBeNull();
  });

  it("reserves bounded prompt/output units without inventing currency costs", () => {
    const promptCharacters = estimateAiPromptCharacters([{ content: "123456789" }, { content: "abc" }]);
    expect(promptCharacters).toBe(12);
    expect(estimateAiReservationTokens(promptCharacters, 100)).toBe(104);
  });

  it("counts failed and unknown-usage reservations against daily caps", () => {
    const prior = [
      { reservedTokens: 600, promptTokens: 400, completionTokens: 200 },
      { reservedTokens: 0, promptTokens: null, completionTokens: null },
    ];
    expect(aiBudgetDecision(prior, 300, 3, 2_000, 500)).toBeNull();
    expect(aiBudgetDecision(prior, 300, 2, 2_000, 500)).toBe("AI_DAILY_REQUEST_LIMIT");
    expect(aiBudgetDecision(prior, 600, 3, 1_500, 500)).toBe("AI_DAILY_TOKEN_LIMIT");
  });
});

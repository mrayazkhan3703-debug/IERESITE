import { describe, expect, it } from "bun:test";
import { isDisabledAdvisorAction } from "@/server/ai/action-policy";

describe("AI advisor action policy", () => {
  it("blocks lead capture and handoff until trusted consent and durable commands exist", () => {
    expect(isDisabledAdvisorAction("capture_lead")).toBe(true);
    expect(isDisabledAdvisorAction("human_handoff")).toBe(true);
    expect(isDisabledAdvisorAction("search_properties")).toBe(false);
  });
});

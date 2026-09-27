import { describe, expect, it } from "bun:test";
import { ANALYTICS_EVENT_NAMES, isAnalyticsEventName } from "@/lib/analytics-events";

describe("shared analytics event registry", () => {
  it("has unique names and includes the newer UI events that previously drifted from the API", () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
    for (const name of ["ai_tool_result_viewed", "evidence_open", "search_filter_changed", "3d_atlas_opened"] as const) {
      expect(isAnalyticsEventName(name)).toBe(true);
    }
  });

  it("rejects unregistered names rather than persisting arbitrary event labels", () => {
    expect(isAnalyticsEventName("consultation_booked")).toBe(false);
    expect(isAnalyticsEventName("attacker_supplied_event")).toBe(false);
  });
});

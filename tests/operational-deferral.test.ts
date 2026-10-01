import { describe, expect, it } from "bun:test";
import { externalCrmDeferred, crmDeliveryDeferred } from "@/server/crm/deferral";
import { JobDeferredError } from "@/server/jobs/deferred";
import { advisorFailureReply } from "@/server/ai/failure-reply";

describe("operational deferral and localized failure responses", () => {
  it("prevents external CRM delivery while retaining local development simulation", () => {
    expect(externalCrmDeferred({ CRM_SYNC_DEFERRED: true, CRM_LIVE_ENABLED: true })).toBe(true);
    expect(externalCrmDeferred({ CRM_SYNC_DEFERRED: false, CRM_LIVE_ENABLED: false })).toBe(true);
    expect(externalCrmDeferred({ CRM_SYNC_DEFERRED: false, CRM_LIVE_ENABLED: true })).toBe(false);
    for (const APP_ENV of ["staging", "production"] as const) expect(crmDeliveryDeferred({ APP_ENV, CRM_PROVIDER: "localdev", CRM_SYNC_DEFERRED: true, CRM_LIVE_ENABLED: false })).toBe(true);
    expect(crmDeliveryDeferred({ APP_ENV: "development", CRM_PROVIDER: "localdev", CRM_SYNC_DEFERRED: true, CRM_LIVE_ENABLED: false })).toBe(false);
    expect(new JobDeferredError()).toMatchObject({ code: "CRM_SYNC_DEFERRED", retryAfterMs: 86400000 });
  });
  it("explains gate failures and provider failures in the requested language", () => {
    for (const code of ["AI_KILL_SWITCH", "AI_LIVE_DISABLED", "AI_PROVIDER_NOT_APPROVED", "AI_DAILY_REQUEST_LIMIT", "AI_DAILY_TOKEN_LIMIT", "AI_PROMPT_TOO_LARGE", "AI_BUDGET_BUSY", null]) {
      expect(advisorFailureReply(code, "ar")).toMatch(/[\u0600-\u06ff]/);
      expect(advisorFailureReply(code, "en")).not.toMatch(/[\u0600-\u06ff]/);
    }
    expect(advisorFailureReply(null, "ar")).toContain("لا تُنقل هذه المحادثة تلقائياً");
    expect(advisorFailureReply(null)).toContain("not transferred automatically");
    expect(advisorFailureReply("untrusted secret")).not.toContain("secret");
  });
});

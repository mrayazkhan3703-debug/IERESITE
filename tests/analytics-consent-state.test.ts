import { beforeEach, describe, expect, it } from "bun:test";
import { applyServerConsent, beginConsentUpdate, clearVerifiedConsent, getVerifiedConsent } from "@/lib/analytics-consent-state";

beforeEach(() => clearVerifiedConsent());

describe("server-verified analytics consent state", () => {
  it("defaults to denied and accepts only a decided server snapshot", () => {
    expect(getVerifiedConsent()).toEqual({ essential: true, analytics: false, marketing: false, personalization: false });
    expect(applyServerConsent({ decided: false, analytics: true, marketing: true, personalization: true })).toEqual({
      essential: true, analytics: false, marketing: false, personalization: false,
    });
    expect(applyServerConsent({ decided: true, analytics: true, marketing: false, personalization: true })).toEqual({
      essential: true, analytics: true, marketing: false, personalization: true,
    });
  });

  it("fails closed while choices are submitted and after they are cleared", () => {
    applyServerConsent({ decided: true, analytics: true, marketing: true, personalization: true });
    beginConsentUpdate();
    expect(getVerifiedConsent().analytics).toBe(false);
    clearVerifiedConsent();
    expect(getVerifiedConsent()).toEqual({ essential: true, analytics: false, marketing: false, personalization: false });
  });

  it("does not reuse a prior browser-wide decision until the current session is verified again", () => {
    applyServerConsent({ decided: true, analytics: true, marketing: true, personalization: false });
    clearVerifiedConsent();
    expect(getVerifiedConsent()).toEqual({ essential: true, analytics: false, marketing: false, personalization: false });
  });
});

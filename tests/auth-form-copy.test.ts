import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/lib/api-client";
import { authFormError } from "../src/lib/auth-form-error";
import { dictionaries, t } from "../src/lib/i18n";

describe("localized auth form copy", () => {
  test("every English auth key has non-fallback Arabic copy", () => {
    const keys = Object.keys(dictionaries.en).filter((key) => key.startsWith("auth."));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(Object.hasOwn(dictionaries.ar, key)).toBe(true);
      expect(t(key, "ar")).not.toBe(key);
      expect(t(key, "ar")).not.toBe(t(key, "en"));
    }
  });
  test("maps known API codes without exposing exception text", () => {
    for (const code of ["INVALID_CREDENTIALS", "LOCKED", "EMAIL_VERIFICATION_REQUIRED", "RATE_LIMITED", "VALIDATION", "EMAIL_TAKEN", "INVALID_MFA_CODE", "INVALID_CHALLENGE"]) {
      const copy = authFormError(new ApiError("synthetic transport internals", 400, code), "ar");
      expect(copy).not.toBe(t("auth.failed", "ar"));
      expect(copy).not.toContain("synthetic");
    }
  });
  test("unknown, inherited and transport errors use a localized generic failure", () => {
    for (const error of [new ApiError("private detail", 500, "UNKNOWN"), new ApiError("private detail", 500, "toString"), new Error("private detail"), null]) {
      expect(authFormError(error, "ar")).toBe(t("auth.failed", "ar"));
      expect(authFormError(error, "en")).toBe(t("auth.failed", "en"));
    }
  });
  test("reset notice describes acceptance, not confirmed delivery", () => {
    expect(t("auth.resetAccepted", "en")).toContain("Request accepted.");
    expect(t("auth.resetAccepted", "en")).not.toContain("has been sent");
    expect(t("auth.resetAccepted", "ar")).toContain("تم قبول الطلب");
  });
});

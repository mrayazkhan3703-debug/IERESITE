import { describe, expect, test } from "bun:test";
import { parseConfig, requiresSecureCookies } from "@/lib/config";

describe("session cookie transport policy", () => {
  test("only local development permits non-Secure cookies", () => {
    expect(requiresSecureCookies({ APP_ENV: "development" })).toBe(false);
    expect(requiresSecureCookies({ APP_ENV: "staging" })).toBe(true);
    expect(requiresSecureCookies({ APP_ENV: "production" })).toBe(true);
  });

  test("web-only preview cannot accidentally be enabled outside staging", () => {
    expect(parseConfig({ APP_ENV: "staging", STAGING_WEB_ONLY: "true", DATABASE_URL: "postgresql://localhost/test" }).STAGING_WEB_ONLY).toBe(true);
    expect(() => parseConfig({ APP_ENV: "production", STAGING_WEB_ONLY: "true", DATABASE_URL: "postgresql://localhost/test", IP_PSEUDONYM_KEY: "x".repeat(32) })).toThrow("STAGING_WEB_ONLY");
  });
});

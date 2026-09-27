import { describe, expect, it } from "bun:test";
import { parseConfig } from "@/lib/config";
import { pseudonymizeIp, resolveTrustedClientIp } from "@/server/security/ip-address";

describe("trusted client IP handling", () => {
  it("ignores forwarded headers until an exact trusted proxy count is configured", () => {
    const request = new Request("https://example.invalid", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-real-ip": "198.51.100.10" },
    });
    expect(resolveTrustedClientIp(request, 0)).toBe("unknown");
    expect(resolveTrustedClientIp(new Request("https://example.invalid", { headers: { "x-real-ip": "198.51.100.10" } }), 1)).toBe("unknown");
  });

  it("selects the rightmost non-proxy address and rejects invalid proxy chains", () => {
    const oneProxy = new Request("https://example.invalid", {
      headers: { "x-forwarded-for": "192.0.2.44, 198.51.100.27" },
    });
    expect(resolveTrustedClientIp(oneProxy, 1)).toBe("198.51.100.27");

    const twoProxies = new Request("https://example.invalid", {
      headers: { "x-forwarded-for": "192.0.2.44, 198.51.100.27, 203.0.113.19" },
    });
    expect(resolveTrustedClientIp(twoProxies, 2)).toBe("198.51.100.27");
    expect(resolveTrustedClientIp(twoProxies, 4)).toBe("unknown");
    expect(resolveTrustedClientIp(new Request("https://example.invalid", { headers: { "x-forwarded-for": "attacker.invalid" } }), 1)).toBe("unknown");
  });

  it("uses a keyed stable pseudonym and never returns the raw address", () => {
    const first = pseudonymizeIp("203.0.113.7", "unit-test-secret-that-is-at-least-32-chars");
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).toBe(pseudonymizeIp("203.0.113.7", "unit-test-secret-that-is-at-least-32-chars"));
    expect(first).not.toBe(pseudonymizeIp("203.0.113.7", "another-unit-test-secret-at-least-32"));
    expect(first).not.toContain("203.0.113.7");
    expect(pseudonymizeIp("not-an-ip", "unit-test-secret-that-is-at-least-32-chars")).toBeNull();
    expect(pseudonymizeIp("203.0.113.7", null)).toBeNull();
  });

  it("requires a pseudonym key in production configuration", () => {
    const env = {
      ...process.env,
      APP_ENV: "production",
      DATABASE_URL: "postgresql://iere:local-only@localhost:5432/iere",
      IP_PSEUDONYM_KEY: "",
    };
    expect(() => parseConfig(env)).toThrow(/IP_PSEUDONYM_KEY/);
  });
});

import { describe, expect, it } from "bun:test";
import { buildContentSecurityPolicy, createCspNonce } from "@/server/security/content-security-policy";

describe("content security policy", () => {
  it("generates unpredictable response nonces in CSP-safe base64 form", () => {
    const first = createCspNonce();
    const second = createCspNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(first.length).toBeGreaterThanOrEqual(24);
    expect(second).not.toBe(first);
  });

  it("requires a nonce for scripts and blocks plugin, form and framing abuse", () => {
    const policy = buildContentSecurityPolicy("dGVzdC1ub25jZS0xMjM0NTY3ODkw");
    expect(policy).toContain("script-src 'self' 'nonce-dGVzdC1ub25jZS0xMjM0NTY3ODkw' 'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'self'");
  });

  it("rejects malformed nonce input rather than interpolating it into a header", () => {
    expect(() => buildContentSecurityPolicy("abc'; script-src *")).toThrow("Invalid CSP nonce.");
  });
});

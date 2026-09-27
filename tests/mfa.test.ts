import { describe, expect, test } from "bun:test";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  requiresPrivilegedMfa,
  totpCode,
  verifyTotp,
} from "@/server/mfa";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.AUTH_MFA_ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("privileged MFA", () => {
  test("identifies privileged roles", () => {
    expect(requiresPrivilegedMfa(["CUSTOMER"])).toBe(false);
    expect(requiresPrivilegedMfa(["AGENT"])).toBe(false);
    expect(requiresPrivilegedMfa(["CONTENT_EDITOR"])).toBe(true);
    expect(requiresPrivilegedMfa(["OWNER"])).toBe(true);
  });

  test("encrypts TOTP secrets and verifies only the time-window code", () => {
    const secret = generateMfaSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
    const at = 1_790_000_000_000;
    const code = totpCode(secret, at);
    expect(verifyTotp(secret, code, at)).toBe(true);
    expect(verifyTotp(secret, code === "000000" ? "000001" : "000000", at)).toBe(false);
  });

  test("recovery codes are unique and only hashes need persistence", () => {
    const recovery = generateRecoveryCodes();
    expect(recovery.raw).toHaveLength(10);
    expect(new Set(recovery.raw).size).toBe(10);
    expect(recovery.hashes).toHaveLength(10);
    expect(recovery.hashes[0]).not.toContain(recovery.raw[0]);
  });
});

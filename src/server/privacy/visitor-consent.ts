import { createHash, randomBytes } from "node:crypto";

export const VISITOR_CONSENT_COOKIE = "ie_consent_session";
export const CURRENT_CONSENT_POLICY_VERSION = "2026-09-v1";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readVisitorConsentToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== VISITOR_CONSENT_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function createVisitorConsentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashVisitorConsentToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid visitor consent token");
  return createHash("sha256").update(token).digest("hex");
}

/** Browser-session-only cookie: no expiry is selected before retention review. */
export function visitorConsentCookie(token: string, secure: boolean): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid visitor consent token");
  return `${VISITOR_CONSENT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

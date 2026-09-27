import { db } from "@/lib/db";
import {
  CURRENT_CONSENT_POLICY_VERSION,
  hashVisitorConsentToken,
  readVisitorConsentToken,
} from "@/server/privacy/visitor-consent";

/** Return only a first-party session with a current, server-recorded analytics grant. */
export async function grantedAnalyticsSessionId(request: Request): Promise<string | null> {
  const token = readVisitorConsentToken(request);
  if (!token) return null;

  const sessionKey = hashVisitorConsentToken(token);
  const [session, consent] = await Promise.all([
    db.websiteSession.findUnique({ where: { sessionKey }, select: { id: true } }),
    db.consent.findFirst({
      where: {
        subjectType: "VISITOR",
        sessionKey,
        policyVersion: CURRENT_CONSENT_POLICY_VERSION,
        purpose: "ANALYTICS",
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
      select: { status: true },
    }),
  ]);

  return session && consent?.status === "GRANTED" ? session.id : null;
}

/** Keep attribution paths first-party and strip query/hash values that can carry PII. */
export function safeAttributionPath(value?: string | null): string | null {
  if (!value) return null;
  const path = value.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  return path.slice(0, 300);
}

export function safeAttributionReferrer(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export function safeAttributionUtm(value?: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().slice(0, 100);
  if (!clean || /@|(?:\+?\d[\d\s().-]{7,})/.test(clean)) return null;
  return clean;
}

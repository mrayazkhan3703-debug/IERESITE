import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getConfig, requiresSecureCookies } from "@/lib/config";

export const AI_SESSION_COOKIE = "ie_ai_session";
const AI_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const AI_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AI_SESSION_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isAiSessionToken(value: string): boolean {
  return AI_SESSION_TOKEN_PATTERN.test(value);
}

export function hashAiSessionToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type AiConversationOwnerWhere =
  | { userId: string; sessionKey: null }
  | { userId: null; sessionKey: string };

/** Return only an unambiguous authenticated-user or hashed-anonymous owner scope. */
export function aiConversationOwnerWhere(
  userId: string | null | undefined,
  sessionHash: string | null | undefined
): AiConversationOwnerWhere | null {
  if (userId) return { userId, sessionKey: null };
  if (sessionHash && AI_SESSION_HASH_PATTERN.test(sessionHash)) {
    return { userId: null, sessionKey: sessionHash };
  }
  return null;
}

/** Read or create the HttpOnly browser session; only its SHA-256 hash belongs in the database. */
export async function getAiSessionHash(createIfMissing: boolean): Promise<string | null> {
  const jar = await cookies();
  const current = jar.get(AI_SESSION_COOKIE)?.value;
  if (current && isAiSessionToken(current)) return hashAiSessionToken(current);
  if (!createIfMissing) return null;

  const token = randomBytes(32).toString("base64url");
  jar.set(AI_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requiresSecureCookies(getConfig()),
    path: "/",
    maxAge: AI_SESSION_MAX_AGE_SECONDS,
  });
  return hashAiSessionToken(token);
}

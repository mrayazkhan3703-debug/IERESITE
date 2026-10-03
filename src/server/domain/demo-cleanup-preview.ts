import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/server/auth";

export function cleanupFingerprint(rows: unknown): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
export function signCleanupPreview(actorId: string, fingerprint: string, key: string, now = Date.now()): string {
  if (key.length < 32) throw new Error("Cleanup signing key is unavailable");
  const payload = Buffer.from(JSON.stringify({ purpose: "demo-cleanup", actorId, fingerprint, expiresAt: now + 600000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}
export function requireCleanupPreview(token: string, actorId: string, fingerprint: string, key: string, now = Date.now()): void {
  try {
    if (token.length > 2000 || key.length < 32) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = createHmac("sha256", key).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload.purpose !== "demo-cleanup" || payload.actorId !== actorId || payload.fingerprint !== fingerprint || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + 600000) throw new Error();
  } catch { throw new HttpError(409, "The cleanup preview expired or records changed. Review a new preview.", "DEMO_CLEANUP_PREVIEW_INVALID"); }
}

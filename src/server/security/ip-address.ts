import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Resolve a client address only when the deployment explicitly configures its
 * proxy hop count. Select from the right of X-Forwarded-For so caller-supplied
 * left-hand entries cannot override the address observed by the last proxy.
 */
export function resolveTrustedClientIp(request: Request, trustedProxyHops: number): string {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1 || trustedProxyHops > 8) return "unknown";
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()) ?? [];
  if (chain.length < trustedProxyHops) return "unknown";
  const candidate = chain[chain.length - trustedProxyHops];
  return candidate && isIP(candidate) ? candidate.toLowerCase() : "unknown";
}

/** Store a keyed, truncated HMAC pseudonym instead of a reversible plain hash. */
export function pseudonymizeIp(ip: string | null | undefined, key: string | null | undefined): string | null {
  const address = ip?.trim();
  const secret = key?.trim();
  if (!address || !secret || secret.length < 32 || !isIP(address)) return null;
  return createHmac("sha256", secret).update(address.toLowerCase()).digest("hex").slice(0, 32);
}

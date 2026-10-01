import { isSafeAiErrorCode } from "@/lib/operational-codes";
import { getConfig } from "@/lib/config";
import { resolveTrustedClientIp } from "@/server/security/ip-address";

/**
 * Token-bucket rate limiter (in-process). Buckets: key = routeClass + identity (ip or user).
 * 429 responses include Retry-After. Abuse counters logged.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket) {
  const now = Date.now();
  const elapsed = now - bucket.updatedAt;
  if (elapsed <= 0) return;
  const refillCount = (elapsed / bucket.windowMs) * bucket.limit;
  bucket.tokens = Math.min(bucket.limit, bucket.tokens + refillCount);
  bucket.updatedAt = now;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number; remaining: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit, updatedAt: Date.now(), limit, windowMs };
    buckets.set(key, bucket);
  }
  refill(bucket);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
  }
  const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) * (windowMs / limit) / 1000));
  return { ok: false, retryAfterSec, remaining: 0 };
}

/** Extract an address from the configured trusted proxy chain; ignore caller headers otherwise. */
export function clientIp(req: Request): string {
  return resolveTrustedClientIp(req, getConfig().TRUSTED_PROXY_HOPS);
}

const SENSITIVE_LOG_KEY = /(password|token|api.?key|secret|authorization|cookie|email|phone|name|message|content|note|error|exception|stack)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

/** Redact sensitive event fields recursively and bound arbitrary log payloads. */
export function redactLogData(data: Record<string, unknown>): Record<string, unknown> {
  function clean(value: unknown, key = "", depth = 0): unknown {
    if (key === "errorCode" && isSafeAiErrorCode(value)) return value;
    if (SENSITIVE_LOG_KEY.test(key) && !(/tokens$/i.test(key) && typeof value === "number")) return "[REDACTED]";
    if (depth >= 4) return "[OMITTED]";
    if (typeof value === "string") {
      return value.slice(0, 300).replace(EMAIL_PATTERN, "[EMAIL]").replace(PHONE_PATTERN, "[PHONE]");
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => clean(item, key, depth + 1));
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
      return Object.fromEntries(entries.map(([childKey, childValue]) => [childKey, clean(childValue, childKey, depth + 1)]));
    }
    return "[OMITTED]";
  }

  return clean(data) as Record<string, unknown>;
}

/** Structured, redacted request logging helper */
export function logEvent(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    ...redactLogData(data),
    ts: new Date().toISOString(),
    event,
    service: process.env.SERVICE_NAME?.trim() || "investment-experts",
    appVersion: process.env.APP_VERSION?.trim() || "unknown",
    buildRevision: process.env.BUILD_REVISION?.trim() || "unknown",
  }));
}

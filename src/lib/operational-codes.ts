/** Allowlisted operational categories; never raw provider errors or response bodies. */
export const SAFE_AI_ERROR_CODES = [
  "PROVIDER_TIMEOUT", "PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_FAILED",
  "PROVIDER_REQUEST_INVALID", "PROVIDER_MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE",
  "PROVIDER_NETWORK_FAILED", "PROVIDER_RESPONSE_INVALID", "PROVIDER_OUTPUT_EMPTY",
  "PROVIDER_OUTPUT_TRUNCATED", "PROVIDER_OUTPUT_BLOCKED", "PROVIDER_CONFIG_MISSING",
] as const;
export type SafeAiErrorCode = typeof SAFE_AI_ERROR_CODES[number];
export function isSafeAiErrorCode(value: unknown): value is SafeAiErrorCode {
  return typeof value === "string" && (SAFE_AI_ERROR_CODES as readonly string[]).includes(value);
}

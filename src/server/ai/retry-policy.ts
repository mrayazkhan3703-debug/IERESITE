/** A single transient retry must fit inside the original request deadline. */
export function aiRetryDelay(code: string, alreadyRetried: boolean, remainingMs: number, random = Math.random()): number | null {
  // A completed empty response is safe to retry once. Ambiguous timeouts are not.
  if (!["PROVIDER_UNAVAILABLE", "PROVIDER_OUTPUT_EMPTY"].includes(code) || alreadyRetried) return null;
  const delay = 1000 + Math.floor(Math.max(0, Math.min(1, random)) * 500);
  return remainingMs >= delay + 5000 ? delay : null;
}

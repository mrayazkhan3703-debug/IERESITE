/** A single transient retry must fit inside the original request deadline. */
export function aiRetryDelay(code: string, alreadyRetried: boolean, remainingMs: number, random = Math.random()): number | null {
  if (code !== "PROVIDER_UNAVAILABLE" || alreadyRetried) return null;
  const delay = 1000 + Math.floor(Math.max(0, Math.min(1, random)) * 500);
  return remainingMs >= delay + 5000 ? delay : null;
}

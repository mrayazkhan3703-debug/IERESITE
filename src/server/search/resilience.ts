import { HttpError } from "@/server/auth";
/** A projection outage can fall back to fresh canonical reads. Never return
 * invented empty results or retain a stale snapshot after both paths fail. */
export async function withSearchFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<{ value: T; degraded: boolean }> {
  try { return { value: await primary(), degraded: false }; }
  catch {
    try { return { value: await fallback(), degraded: true }; }
    catch { throw new HttpError(503, "Property search is temporarily unavailable. Please retry.", "SEARCH_UNAVAILABLE"); }
  }
}

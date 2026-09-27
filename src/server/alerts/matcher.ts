/**
 * Saved-search alert matching (Q27): evaluates saved searches against current
 * inventory, records match counts, creates notifications for new matches.
 */
import { db, parseJson } from "@/lib/db";
import { search } from "@/server/search/service";
import { queryToSearchState } from "@/server/search/types";
import { emitEvent } from "@/server/jobs/outbox";

export async function matchSavedSearches(signal?: AbortSignal): Promise<{ evaluated: number; newMatches: number }> {
  signal?.throwIfAborted();
  const saved = await db.savedSearch.findMany({
    where: { alertConsent: true },
    include: { user: { select: { id: true, name: true } } },
  });

  let newMatches = 0;
  for (const s of saved) {
    signal?.throwIfAborted();
    const stateQuery = parseJson<Record<string, string>>(s.searchStateJson, {});
    const state = queryToSearchState(stateQuery);
    const result = await search({ ...state, page: 1, pageSize: 12 });
    signal?.throwIfAborted();
    const delta = Math.max(0, result.total - s.lastMatchCount);
    await db.savedSearch.update({
      where: { id: s.id },
      data: { lastMatchCount: result.total, lastMatchedAt: new Date() },
    });
    if (delta > 0) {
      newMatches += delta;
      await db.notification.create({
        data: {
          userId: s.userId,
          kind: "SAVED_SEARCH_MATCH",
          title: `${delta} new ${delta === 1 ? "property matches" : "properties match"} your saved search`,
          body: s.name
            ? `Your saved search “${s.name}” now has ${result.total} matching properties.`
            : `${result.total} properties now match your saved search.`,
          payloadJson: JSON.stringify({ savedSearchId: s.id, newMatches: delta, total: result.total }),
        },
      });
      // Delivery queued via notification delivery cycle (email adapter dev-mode)
      await emitEvent("notification", s.id, "lead.updated", { kind: "SAVED_SEARCH_MATCH", userId: s.userId });
    }
  }
  return { evaluated: saved.length, newMatches };
}

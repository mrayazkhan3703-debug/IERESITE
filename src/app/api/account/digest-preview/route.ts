import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { search } from "@/server/search/service";
import { queryToSearchState } from "@/server/search/types";
import type { ListingCardDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_SEARCHES = 5;
const PREVIEW_PER_SEARCH = 3;

interface DigestEntry {
  searchId: string;
  name: string;
  frequency: string;
  /** Live result count for the stored criteria right now */
  total: number;
  /** Last count recorded by the saved-search matcher */
  lastMatchCount: number;
  lastMatchedAt: string | null;
  preview: {
    slug: string;
    title: string;
    price: { minor: string; currency: string };
    bedrooms: number;
    community: string;
    coverUrl: string | null;
    isDemoData: boolean;
  }[];
}

/**
 * Email-digest preview (Q27 polish): renders what a saved-search alert
 * email would contain for the signed-in user. Delivery itself remains
 * queued behind the production email provider (docs/BLOCKERS.md) —
 * this endpoint only previews the content, deterministically, from
 * live search results.
 */
export const GET = apiHandler(async () => {
  const user = await requireUser();

  const searches = await db.savedSearch.findMany({
    where: { userId: user.id, alertConsent: true },
    orderBy: { createdAt: "desc" },
    take: MAX_SEARCHES,
  });

  const entries: DigestEntry[] = [];
  for (const s of searches) {
    let total = s.lastMatchCount;
    let preview: DigestEntry["preview"] = [];
    try {
      const state = queryToSearchState(JSON.parse(s.searchStateJson) as Record<string, string>);
      const result = await search({ ...state, page: 1, pageSize: PREVIEW_PER_SEARCH });
      total = result.total;
      preview = result.results.map((r: ListingCardDTO) => ({
        slug: r.slug,
        title: r.title,
        price: { minor: String(r.price.minor), currency: r.price.currency },
        bedrooms: r.bedrooms,
        community: r.community.name,
        coverUrl: r.cover?.url ?? null,
        isDemoData: r.isDemoData ?? false,
      }));
    } catch {
      // A stored search that no longer resolves (e.g. invalid state) falls
      // back to the last recorded match count with an empty preview.
    }
    entries.push({
      searchId: s.id,
      name: s.name ?? "Saved search",
      frequency: s.alertFrequency,
      total,
      lastMatchCount: s.lastMatchCount,
      lastMatchedAt: s.lastMatchedAt?.toISOString() ?? null,
      preview,
    });
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    entries,
    deliveryNote:
      "Email delivery is queued until the production email provider credential is activated (docs/BLOCKERS.md). This preview shows exactly what would be sent.",
  });
});

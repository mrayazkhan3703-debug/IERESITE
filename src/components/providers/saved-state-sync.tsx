"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { useSavedStore } from "@/components/providers/saved-provider";
import { detailToCard, type PropertyDetailV2 } from "@/components/property/detail-shared";
import type { ListingCardDTO } from "@/lib/types";

async function loadCards(slugs: string[], signal: AbortSignal): Promise<ListingCardDTO[]> {
  const cards = await Promise.all(slugs.map(async (slug) => {
    try {
      return detailToCard(await api.get<PropertyDetailV2>(`/api/properties/${slug}`, signal));
    } catch {
      return null;
    }
  }));
  return cards.filter((card): card is ListingCardDTO => card !== null);
}

/** Merge durable server state with pre-login local state after authentication. */
export function SavedStateSync({ userId }: { userId: string | null }) {
  React.useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void (async () => {
      const local = useSavedStore.getState();
      const [favoriteResult, comparisonResult, recentResult] = await Promise.all([
        api.get<{ favorites: Array<{ slug: string }> }>("/api/favorites", controller.signal),
        api.get<{ comparison: { properties: Array<{ slug: string }> } | null }>("/api/account/comparisons", controller.signal),
        api.get<{ recentlyViewed: Array<{ slug: string }> }>("/api/recently-viewed", controller.signal),
      ]);
      if (controller.signal.aborted) return;

      const union = (first: string[], second: string[], limit: number) =>
        [...new Set([...first, ...second])].slice(0, limit);
      const favoriteSlugs = union(local.favorites.map((item) => item.slug), favoriteResult.favorites.map((item) => item.slug), 60);
      const compareSlugs = union(local.compare.map((item) => item.slug), comparisonResult.comparison?.properties.map((item) => item.slug) ?? [], 4);
      const recentSlugs = union(local.recentlyViewed.map((item) => item.slug), recentResult.recentlyViewed.map((item) => item.slug), 12);

      const allCards = await loadCards([...new Set([...favoriteSlugs, ...compareSlugs, ...recentSlugs])], controller.signal);
      if (controller.signal.aborted) return;
      const bySlug = new Map(allCards.map((card) => [card.slug, card]));
      useSavedStore.getState().replaceFromServer({
        favorites: favoriteSlugs.flatMap((slug) => bySlug.get(slug) ? [bySlug.get(slug)!] : []),
        compare: compareSlugs.flatMap((slug) => bySlug.get(slug) ? [bySlug.get(slug)!] : []),
        recentlyViewed: recentSlugs.flatMap((slug) => bySlug.get(slug) ? [bySlug.get(slug)!] : []),
      });

      const serverFavorites = new Set(favoriteResult.favorites.map((item) => item.slug));
      await Promise.all(favoriteSlugs.filter((slug) => !serverFavorites.has(slug)).map((propertySlug) =>
        api.post("/api/favorites", { propertySlug }).catch(() => null),
      ));
      await api.put("/api/account/comparisons", { propertySlugs: compareSlugs }).catch(() => null);
      const serverRecent = new Set(recentResult.recentlyViewed.map((item) => item.slug));
      await Promise.all(recentSlugs.filter((slug) => !serverRecent.has(slug)).map((propertySlug) =>
        api.post("/api/recently-viewed", { propertySlug }).catch(() => null),
      ));
    })().catch(() => {
      // Local persistence remains usable while offline or during transient API failure.
    });
    return () => controller.abort();
  }, [userId]);
  return null;
}

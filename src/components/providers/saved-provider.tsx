"use client";

import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ListingCardDTO } from "@/lib/types";
import { events } from "@/lib/analytics-tracker";
import { api } from "@/lib/api-client";

interface SavedState {
  favorites: ListingCardDTO[];
  recentlyViewed: ListingCardDTO[];
  compare: ListingCardDTO[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (listing: ListingCardDTO) => void;
  addRecent: (listing: ListingCardDTO) => void;
  /** DEV-C — clears the local recently-viewed history (display layer only;
   *  server-side telemetry stays intact, there is no DELETE endpoint). */
  clearRecent: () => void;
  toggleCompare: (listing: ListingCardDTO) => void;
  clearCompare: () => void;
  inCompare: (slug: string) => boolean;
  replaceFromServer: (state: Partial<Pick<SavedState, "favorites" | "recentlyViewed" | "compare">>) => void;
}

const MAX_RECENT = 12;
const MAX_COMPARE = 4; // V2 §23: comparison lab supports 2–4 items

export const useSavedStore = create<SavedState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recentlyViewed: [],
      compare: [],
      isFavorite: (slug) => get().favorites.some((f) => f.slug === slug),
      toggleFavorite: (listing) => {
        const { favorites, isFavorite } = get();
        if (isFavorite(listing.slug)) {
          set({ favorites: favorites.filter((f) => f.slug !== listing.slug) });
          events.favorite(listing.slug, "remove");
        } else {
          set({ favorites: [listing, ...favorites].slice(0, 60) });
          events.favorite(listing.slug, "add");
        }
        void api.post("/api/favorites", { propertySlug: listing.slug }).catch(() => {});
      },
      addRecent: (listing) => {
        const rest = get().recentlyViewed.filter((r) => r.slug !== listing.slug);
        set({ recentlyViewed: [listing, ...rest].slice(0, MAX_RECENT) });
        void api.post("/api/recently-viewed", { propertySlug: listing.slug }).catch(() => {});
      },
      clearRecent: () => {
        set({ recentlyViewed: [] });
        void api.delete("/api/recently-viewed").catch(() => {});
      },
      toggleCompare: (listing) => {
        const { compare } = get();
        if (compare.some((c) => c.slug === listing.slug)) {
          const next = compare.filter((c) => c.slug !== listing.slug);
          set({ compare: next });
          void api.put("/api/account/comparisons", { propertySlugs: next.map((item) => item.slug) }).catch(() => {});
        } else if (compare.length < MAX_COMPARE) {
          const next = [...compare, listing];
          set({ compare: next });
          events.compare(next.map((c) => c.slug));
          void api.put("/api/account/comparisons", { propertySlugs: next.map((item) => item.slug) }).catch(() => {});
        }
      },
      clearCompare: () => {
        set({ compare: [] });
        void api.put("/api/account/comparisons", { propertySlugs: [] }).catch(() => {});
      },
      inCompare: (slug) => get().compare.some((c) => c.slug === slug),
      replaceFromServer: (state) => set(state),
    }),
    {
      name: "ie_saved_v1",
      partialize: (s) => ({ favorites: s.favorites, recentlyViewed: s.recentlyViewed, compare: s.compare }),
    }
  )
);

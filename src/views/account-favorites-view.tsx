"use client";

import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { useSavedStore } from "@/components/providers/saved-provider";
import { PropertyCard } from "@/components/property/property-card";
import { Breadcrumbs, SectionHeading, EmptyState, LoadingState } from "@/components/common";
import { api } from "@/lib/api-client";
import type { ListingCardDTO } from "@/lib/types";

/** Saved properties (A44): local favorites merged with server-side when authenticated */
export default function AccountFavoritesView() {
  const { user, loading } = useAuth();
  const localFavorites = useSavedStore((s) => s.favorites);
  const [serverFavorites, setServerFavorites] = React.useState<string[] | null>(null);

  usePageMeta({ title: "Saved Properties", noindex: true });

  React.useEffect(() => {
    if (user) {
      api.get<{ favorites: { slug: string; title: string; savedAt: string }[] }>("/api/favorites")
        .then((r) => setServerFavorites(r.favorites.map((f) => f.slug)))
        .catch(() => setServerFavorites([]));
    } else {
      setServerFavorites([]);
    }
  }, [user]);

  // merge: local + server (server list needs full cards; use local cards + fetch others lazily)
  const merged = React.useMemo(() => {
    const map = new Map<string, ListingCardDTO>();
    localFavorites.forEach((f) => map.set(f.slug, f));
    serverFavorites?.forEach((slug) => {
      if (!map.has(slug)) map.set(slug, { ...localFavorites[0], slug, title: slug } as unknown as ListingCardDTO);
    });
    return [...map.values()];
  }, [localFavorites, serverFavorites]);

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Saved properties" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="Your shortlist"
          title="Saved properties"
          description={user ? "Synced to your account across devices." : "Saved locally — sign in to sync across devices."}
        />
      </div>
      <div className="mt-6">
        {merged.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            description="Tap the heart on any property to build your shortlist."
            actionLabel="Browse properties"
            onAction={() => navigate("/properties")}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {merged.map((f) => (f.id ? <PropertyCard key={f.slug} listing={f} /> : null))}
          </div>
        )}
      </div>
    </div>
  );
}

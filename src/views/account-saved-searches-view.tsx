"use client";

import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { Breadcrumbs, SectionHeading, EmptyState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { formatNumber, formatDate } from "@/lib/money";
import { Search, Trash2 } from "lucide-react";

interface SavedSearch {
  id: string;
  name: string | null;
  searchState: Record<string, string>;
  alertConsent: boolean;
  alertFrequency: string;
  lastMatchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
}

export default function AccountSavedSearchesView() {
  const { user, loading } = useAuth();
  const [searches, setSearches] = React.useState<SavedSearch[] | null>(null);

  usePageMeta({ title: "Saved Searches", noindex: true });

  const load = React.useCallback(() => {
    if (user) {
      api.get<{ savedSearches: SavedSearch[] }>("/api/saved-searches").then((r) => setSearches(r.savedSearches)).catch(() => setSearches([]));
    } else setSearches([]);
  }, [user]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    await api.delete(`/api/saved-searches?id=${id}`).catch(() => {});
    load();
  };

  if (loading || searches === null) return <div className="container-page py-12"><LoadingState /></div>;

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Saved searches" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="Your criteria"
          title="Saved searches"
          description="Re-run a search in one click — or manage alert consent and frequency per search."
        />
      </div>

      <div className="mt-6 space-y-4">
        {!user && searches.length === 0 && (
          <EmptyState
            title="Sign in to save searches"
            description="Save any search from the results page, then re-run it or get alerts when new properties match."
            actionLabel="Sign in"
            onAction={() => navigate("/account/login")}
          />
        )}
        {user && searches.length === 0 && (
          <EmptyState
            title="No saved searches yet"
            description="Use 'Save search' on any results page — with alerts on, we'll notify you about new matches."
            actionLabel="Start searching"
            onAction={() => navigate("/properties")}
          />
        )}
        {searches.map((s) => {
          const params = new URLSearchParams(s.searchState).toString();
          return (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <Search className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <h2 className="truncate font-semibold">{s.name ?? "Saved search"}</h2>
                  {s.alertConsent && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      Alerts · {s.alertFrequency.toLowerCase()}
                    </span>
                  )}
                </div>
                <p className="num mt-1 text-xs text-muted-foreground">
                  {formatNumber(s.lastMatchCount)} matches{s.lastMatchedAt ? ` · checked ${formatDate(s.lastMatchedAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/properties" query={s.searchState}>Re-run</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/account/alerts">Alert settings</Link>
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${s.name ?? "saved search"}`} onClick={() => remove(s.id)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

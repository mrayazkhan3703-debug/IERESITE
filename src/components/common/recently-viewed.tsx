"use client";

/**
 * Recently viewed (DEV-C personalization layer).
 *
 * Two surfaces sharing one history source:
 *  - `RecentlyViewedSection` — homepage strip (renders NOTHING without
 *    history: no empty state, no layout shift on a fresh session).
 *  - `RecentlyViewedStrip` — dismissible strip above the /properties results
 *    grid (session-scoped dismissal via sessionStorage).
 *
 * Data: the persisted `useSavedStore.recentlyViewed` mirror that property
 * detail pages already populate (`addRecent(detailToCard(d))` alongside the
 * POST /api/recently-viewed telemetry). For signed-in visitors the homepage
 * additionally re-hydrates from the existing backend (GET /api/recently-viewed)
 * so a new device still shows cross-session history; the anonymous path is
 * fully local. The backend exposes no DELETE method, so "Clear" clears the
 * local display history (documented fallback) — server telemetry stays intact.
 *
 * Rendering is gated behind a post-mount flag: SSR and the first client paint
 * emit nothing (no hydration mismatch, no shift), then the section fades in
 * only when history exists. All motion respects prefers-reduced-motion.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Layers, History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { events } from "@/lib/analytics-tracker";
import { useSavedStore } from "@/components/providers/saved-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { PropertyCard } from "@/components/property/property-card";
import { detailToCard, type PropertyDetailV2 } from "@/components/property/detail-shared";
import { fromMinor } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import type { ListingCardDTO } from "@/lib/types";

const STRIP_DISMISS_KEY = "ie_rv_strip_dismissed";
const MAX_ITEMS = 12;

/* ----------------------------- shared hook ----------------------------- */

/** Local history is render-ready only after mount (persist hydration + SSR gate). */
function useLocalHistory() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const items = useSavedStore((s) => s.recentlyViewed);
  return { ready: mounted, items };
}

/**
 * Server merge (homepage only): for signed-in visitors, pull the backend
 * history and backfill any slugs the local device is missing. Bounded to the
 * API's own take(12); every call is abortable and failures are silent — the
 * local store renders regardless.
 */
function useServerHistoryMerge(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await api.get<{ recentlyViewed: { slug: string }[] }>("/api/recently-viewed", ctrl.signal);
        const slugs = (res.recentlyViewed ?? []).map((r) => r.slug);
        if (ctrl.signal.aborted || slugs.length === 0) return;
        const known = new Set(useSavedStore.getState().recentlyViewed.map((r) => r.slug));
        const missing = slugs.filter((s) => !known.has(s));
        // API order is newest-first; addRecent also prepends, so backfill in
        // reverse to land on the server's ordering once merged.
        for (const slug of missing.slice(0, MAX_ITEMS).reverse()) {
          if (ctrl.signal.aborted) return;
          try {
            const d = await api.get<PropertyDetailV2>(`/api/properties/${slug}`, ctrl.signal);
            useSavedStore.getState().addRecent(detailToCard(d));
          } catch {
            /* property may have been withdrawn — skip, never surface */
          }
        }
      } catch {
        /* anonymous (401) or offline — local history still renders */
      }
    })();
    return () => ctrl.abort();
  }, [enabled]);
}

/** History price label — "AED 2.1M" or an honest fallback when unknown. */
function recentPrice(listing: ListingCardDTO, locale: Locale): string {
  if (listing.price && listing.price.minor && listing.price.minor !== "0") {
    return formatAEDPrecise(fromMinor(listing.price.minor));
  }
  return t("recently.priceFallback", locale);
}

/** Scrollable list shell — keyboard-scrollable region, snap, elegant scrollbar. */
function ScrollStrip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <ul
      role="list"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "scroll-elegant flex snap-x snap-mandatory list-none gap-4 overflow-x-auto pb-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand scroll-fade-x",
        className
      )}
    >
      {children}
    </ul>
  );
}

/* --------------------------- homepage section --------------------------- */

export function RecentlyViewedSection({ locale }: { locale: Locale }) {
  const { ready, items } = useLocalHistory();
  const clearRecent = useSavedStore((s) => s.clearRecent);
  const { user, loading } = useAuth();
  const { toast } = useToast();

  useServerHistoryMerge(ready && !loading && !!user);

  /* Fresh session → render nothing at all (no heading, no empty state). */
  if (!ready || items.length === 0) return null;

  const handleClear = () => {
    clearRecent();
    events.recentlyViewedCleared("home");
    toast({ title: t("recently.cleared", locale) });
  };

  return (
    <section
      aria-labelledby="recently-viewed-heading"
      className="section-plain section-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
    >
      <div className="container-page">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="kicker kicker-accent mb-2">{t("recently.kicker", locale)}</p>
            <h2 id="recently-viewed-heading" className="type-h3">
              {t("recently.title", locale)}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("recently.subtitle", locale)}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            aria-label={t("recently.clearLabel", locale)}
            className="h-11 gap-1.5 px-4 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            {t("recently.clear", locale)}
          </Button>
        </div>

        <ScrollStrip label={t("recently.sr.scrollRegion", locale)}>
          {items.slice(0, MAX_ITEMS).map((l) => (
            <li key={l.slug} className="w-[260px] shrink-0 snap-start sm:w-[290px] lg:w-[310px]">
              <PropertyCard listing={l} compact />
            </li>
          ))}
        </ScrollStrip>
      </div>
    </section>
  );
}

/* ------------------------ /properties dismissible strip ------------------------ */

export function RecentlyViewedStrip({ locale }: { locale: Locale }) {
  const { ready, items } = useLocalHistory();
  const [dismissed, setDismissed] = React.useState(false);

  /* Session-scoped dismissal — reappears next session, never mid-session. */
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(STRIP_DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* private mode — treat as not dismissed */
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STRIP_DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — in-memory dismissal still holds for this mount */
    }
  };

  if (!ready || dismissed || items.length === 0) return null;

  return (
    <div
      className="mb-5 rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm backdrop-blur motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300 sm:p-4"
      aria-labelledby="rv-strip-heading"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 id="rv-strip-heading" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <History className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span className="truncate">{t("recently.title", locale)}</span>
        </h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("recently.dismissLabel", locale)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <ScrollStrip label={t("recently.sr.scrollRegion", locale)} className="gap-3">
        {items.slice(0, MAX_ITEMS).map((l) => (
          <li key={l.slug} className="snap-start shrink-0">
            <Link
              to={`/properties/${l.slug}`}
              className="flex w-52 items-center gap-3 rounded-lg border border-border/70 bg-background p-2 transition-ui hover:border-brand/40 hover:shadow-[0_6px_18px_-10px_rgba(139,90,43,0.25)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            >
              <span className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sand" aria-hidden>
                {l.cover ? (
                  <img src={l.cover.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover zoom-media" />
                ) : (
                  <Layers className="h-5 w-5 text-muted-foreground/40" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-snug text-ink/90">{l.title}</span>
                <span className="num block truncate text-xs text-muted-foreground">
                  {recentPrice(l, locale)} · {l.community.name}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ScrollStrip>
    </div>
  );
}

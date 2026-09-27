"use client";

/**
 * Community living section (U08 — V2 §16 "life & commute").
 *
 * - POI category chips render ONLY from actual community fields — categories
 *   without records are omitted entirely, never fabricated (no restaurants
 *   field exists in the schema, so no restaurants chip can ever appear until
 *   a source provides one).
 * - Commute context: straight-line distances to DIFC / Downtown Dubai anchors,
 *   computed client-side from coordinates, with an explicit methodology note
 *   (straight-line; driving distance may differ).
 */

import * as React from "react";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import { COMMUTE_ANCHORS, haversineKm } from "./entity-shared";
import { Train, GraduationCap, HeartPulse, ShoppingBag, MapPin, Info, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

interface PoiCategory {
  key: string;
  label: string;
  icon: typeof Train;
  items: string[];
}

export function EntityPoiCommute({
  community,
  locale = "en",
}: {
  community: {
    name: string;
    lat: number;
    lng: number;
    transport: { type: string; name: string; distance: string }[];
    schools: { name: string; rating: string }[];
    healthcare: { name: string; type: string }[];
    retail: { name: string; type: string }[];
  };
  locale?: Locale;
}) {
  const [activeChip, setActiveChip] = React.useState<string | null>(null);

  const categories = React.useMemo<PoiCategory[]>(() => {
    const cats: PoiCategory[] = [];
    const transit = (community.transport ?? []).filter((tr) => /metro|tram|rail|bus/i.test(tr.type));
    if (transit.length > 0) {
      cats.push({
        key: "transport",
        label: t("community.poi.transport", locale),
        icon: Train,
        items: transit.map((m) => `${m.name}${m.distance ? ` (${m.distance})` : ""}`),
      });
    }
    if ((community.schools ?? []).length > 0) {
      cats.push({
        key: "schools",
        label: t("community.poi.schools", locale),
        icon: GraduationCap,
        items: community.schools.map((s) => (s.rating ? `${s.name} (${s.rating})` : s.name)),
      });
    }
    if ((community.healthcare ?? []).length > 0) {
      cats.push({
        key: "healthcare",
        label: t("community.poi.healthcare", locale),
        icon: HeartPulse,
        items: community.healthcare.map((h) => (h.type ? `${h.name} (${h.type.toLowerCase()})` : h.name)),
      });
    }
    if ((community.retail ?? []).length > 0) {
      cats.push({
        key: "retail",
        label: t("community.poi.retail", locale),
        icon: ShoppingBag,
        items: community.retail.map((r) => (r.type ? `${r.name} (${r.type.toLowerCase()})` : r.name)),
      });
    }
    return cats;
  }, [community, locale]);

  const commute = COMMUTE_ANCHORS.map((a) => ({ ...a, km: haversineKm(community.lat, community.lng, a.lat, a.lng) }));
  const activeItems = activeChip ? categories.find((c) => c.key === activeChip)?.items ?? [] : [];

  return (
    <div className="space-y-5">
      {/* POI chips — only categories with real records */}
      {categories.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          <div className="flex flex-wrap gap-2 p-3">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const active = activeChip === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveChip(active ? null : cat.key)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-ui",
                    active
                      ? "border-brand/60 bg-brand-faint text-brand-strong"
                      : "border-border/70 bg-card text-foreground hover:border-brand/40"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {cat.label}
                  <span className="num rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(cat.items.length)}</span>
                </button>
              );
            })}
          </div>
          {activeChip && (
            <div className="border-t border-border/60 bg-secondary/40 p-3">
              <ul className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {activeItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-foreground/85">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("community.poi.none", locale)}</p>
      )}

      {/* Commute context */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Navigation className="h-3.5 w-3.5" aria-hidden /> {t("community.commute.title", locale)}
          </p>
          <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {commute.map((c) => (
              <li
                key={c.key}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3.5 py-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="num shrink-0 font-medium" title={t("community.commute.straightLine", locale)}>
                  {c.km.toFixed(1)} km
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("community.commute.methodology", locale)}
          </p>
        </div>
      </div>
    </div>
  );
}

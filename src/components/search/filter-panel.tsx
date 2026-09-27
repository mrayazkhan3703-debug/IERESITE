"use client";

/**
 * Search filter panel (V2 §12.3, U04) — the single panel used by the desktop
 * sidebar and the mobile bottom sheet. Every control syncs to the URL query
 * through the provided `setParam`. Only filters the backend genuinely
 * supports are shown; mode-irrelevant sections are hidden (not disabled
 * placeholders).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/lib/money";
import { events } from "@/lib/analytics-tracker";
import { MethodologyLink } from "./smart-filters";
import type { SearchMode } from "./mode-tabs";

/** SearchResponse facets + the additive views facet (U04). */
export interface SearchFacetsExt {
  communities: { id: string; name: string; slug: string; count: number }[];
  propertyTypes: { key: string; count: number }[];
  priceBuckets: { key: string; minMinor: string; maxMinor: string | null; count: number }[];
  bedroomCounts: { key: number; count: number }[];
  amenities: { key: string; name: string; count: number }[];
  developers: { id: string; name: string; count: number }[];
  views?: { key: string; count: number }[];
  total: number;
}

const PROPERTY_TYPES = [
  { key: "apartment", labelKey: "search.filters.type.apartment" },
  { key: "villa", labelKey: "search.filters.type.villa" },
  { key: "townhouse", labelKey: "search.filters.type.townhouse" },
  { key: "penthouse", labelKey: "search.filters.type.penthouse" },
  { key: "duplex", labelKey: "search.filters.type.duplex" },
  { key: "studio", labelKey: "search.filters.type.studio" },
];

const VIEW_OPTIONS = [
  { key: "SEA", labelKey: "search.filters.viewType.sea" },
  { key: "MARINA", labelKey: "search.filters.viewType.marina" },
  { key: "SKYLINE", labelKey: "search.filters.viewType.skyline" },
  { key: "GOLF", labelKey: "search.filters.viewType.golf" },
  { key: "PARK", labelKey: "search.filters.viewType.park" },
  { key: "COMMUNITY", labelKey: "search.filters.viewType.community" },
];

const FURNISHING_OPTIONS = [
  { key: "FURNISHED", labelKey: "search.filters.furnishing.furnished" },
  { key: "SEMI_FURNISHED", labelKey: "search.filters.furnishing.semi" },
  { key: "UNFURNISHED", labelKey: "search.filters.furnishing.unfurnished" },
];

export const FILTER_KEYS = [
  "q", "community", "propertyType", "developer", "priceMin", "priceMax", "bedsMin", "bedsMax",
  "bathsMin", "areaMin", "areaMax", "amenities", "offPlan", "furnished", "exclusive", "availability",
  "status", "views", "furnishing", "ppsfMin", "ppsfMax", "yieldMin", "handoverFrom", "handoverTo",
  "postHandover", "smart",
];

export function FilterPanel({
  locale,
  mode,
  query,
  facets,
  communitiesForProjects,
  setParam,
  onClearAll,
  inSheet = false,
}: {
  locale: Locale;
  mode: SearchMode;
  query: Record<string, string>;
  facets?: SearchFacetsExt;
  /** Projects mode has no search facets — plain community list from /api/communities. */
  communitiesForProjects?: { id: string; name: string; slug: string }[];
  setParam: (patch: Record<string, string | undefined>, resetPage?: boolean) => void;
  onClearAll: () => void;
  inSheet?: boolean;
}) {
  const isRent = mode === "rent";
  const isProjects = mode === "projects";
  const isOffplan = mode === "offplan";

  const toggleMulti = (key: string, value: string) => {
    const current = (query[key] ?? "").split(",").filter(Boolean);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setParam({ [key]: next.join(",") || undefined });
  };
  const activeMulti = (key: string, value: string) => (query[key] ?? "").split(",").includes(value);

  const activeFilterCount = FILTER_KEYS.filter((k) => query[k]).length;

  const numInput = (
    id: string,
    key: string,
    labelKey: string,
    placeholder: string,
    min = 0
  ) => (
    <div>
      <Label htmlFor={id} className="sr-only">
        {t(labelKey, locale)}
      </Label>
      <input
        /* keyed on the committed URL value so external changes (recovery
           buttons, back/forward) re-sync the displayed value. */
        key={`${key}:${query[key] ?? ""}`}
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        placeholder={placeholder}
        defaultValue={query[key] ?? ""}
        onBlur={(e) => setParam({ [key]: e.target.value || undefined })}
        className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-ui focus:border-brand/60"
      />
    </div>
  );

  return (
    <div className={cn("space-y-6", inSheet && "pb-2")}>
      {/* Price */}
      <fieldset>
        <legend className="kicker mb-2.5">
          {isRent ? t("search.filters.priceRent", locale) : t("search.filters.price", locale)}
        </legend>
        {facets && !isProjects && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {facets.priceBuckets.filter((b) => b.count > 0).slice(0, 6).map((b) => {
              const min = Number(b.minMinor) / 100;
              const max = b.maxMinor ? Number(b.maxMinor) / 100 : null;
              const active = query.priceMin === String(min) && (!max || query.priceMax === String(max));
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    active
                      ? setParam({ priceMin: undefined, priceMax: undefined })
                      : setParam({ priceMin: String(min), priceMax: max ? String(max) : undefined })
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {max
                    ? `${formatMoney(b.minMinor, { compact: true })}–${formatMoney(b.maxMinor, { compact: true })}`
                    : `${formatMoney(b.minMinor, { compact: true })}+`}
                  <span className="ml-1 text-muted-foreground/60">({b.count})</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {numInput("price-min", "priceMin", "search.filters.minPrice", t("search.filters.min", locale))}
          {numInput("price-max", "priceMax", "search.filters.maxPrice", t("search.filters.max", locale))}
        </div>
        {(query.priceMin || query.priceMax) && (
          <p className="num mt-2 text-xs text-muted-foreground">
            {query.priceMin ? `from ${formatMoney(String(Number(query.priceMin) * 100), { compact: true })}` : "any min"}
            {" → "}
            {query.priceMax ? `to ${formatMoney(String(Number(query.priceMax) * 100), { compact: true })}` : "any max"}
            {isRent ? ` ${t("search.mode.rent.unit", locale)}` : ""}
          </p>
        )}
      </fieldset>

      {/* Bedrooms */}
      {!isProjects && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.bedrooms", locale)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((n) => {
              const active = query.bedsMin === String(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam({ bedsMin: active ? undefined : String(n) })}
                  className={cn(
                    "min-w-11 rounded-md border px-3 py-2 text-sm font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {n === 0 ? t("search.filters.bedsStudio", locale) : `${n}+`}
                </button>
              );
            })}
          </div>
          {facets && (
            <p className="num mt-2 text-xs text-muted-foreground">
              {[...facets.bedroomCounts].sort((a, b) => a.key - b.key).map((b) => `${b.key === 0 ? t("search.filters.bedsStudio", locale) : b.key}+:${b.count}`).join("  ·  ")}
            </p>
          )}
        </fieldset>
      )}

      {/* Property type */}
      {!isProjects && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.propertyType", locale)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {PROPERTY_TYPES.map((ty) => {
              const active = activeMulti("propertyType", ty.key);
              const count = facets?.propertyTypes.find((f) => f.key === ty.key.toUpperCase())?.count;
              return (
                <button
                  key={ty.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleMulti("propertyType", ty.key)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {t(ty.labelKey, locale)}
                  {count !== undefined && <span className="ml-1 text-xs text-muted-foreground/60">{count}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Community */}
      <fieldset>
        <legend className="kicker mb-2.5">{t("search.filters.community", locale)}</legend>
        {facets && !isProjects ? (
          <div className="max-h-44 space-y-1.5 overflow-y-auto scroll-elegant pr-1">
            {[...facets.communities].sort((a, b) => b.count - a.count).map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-ui hover:bg-secondary">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeMulti("community", c.slug)}
                    onChange={() => toggleMulti("community", c.slug)}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {c.name}
                </span>
                <span className="num text-xs text-muted-foreground">{c.count}</span>
              </label>
            ))}
          </div>
        ) : communitiesForProjects?.length ? (
          <div className="max-h-44 space-y-1.5 overflow-y-auto scroll-elegant pr-1">
            {communitiesForProjects.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-ui hover:bg-secondary">
                <input
                  type="checkbox"
                  checked={activeMulti("community", c.slug)}
                  onChange={() => toggleMulti("community", c.slug)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                {c.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      {/* Developer (listing facets) */}
      {!isProjects && facets && facets.developers.length > 0 && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.developer", locale)}</legend>
          <div className="max-h-40 space-y-1.5 overflow-y-auto scroll-elegant pr-1">
            {facets.developers.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-ui hover:bg-secondary">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeMulti("developer", d.id)}
                    onChange={() => toggleMulti("developer", d.id)}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {d.name}
                </span>
                <span className="num text-xs text-muted-foreground">{d.count}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Amenities (multi chips + counts) */}
      {!isProjects && facets && facets.amenities.length > 0 && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.amenities", locale)}</legend>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto scroll-elegant">
            {facets.amenities.map((a) => {
              const active = activeMulti("amenities", a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleMulti("amenities", a.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {a.name}
                  <span className="ml-1 text-muted-foreground/60">({a.count})</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* View */}
      {!isProjects && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.view", locale)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {VIEW_OPTIONS.map((v) => {
              const active = activeMulti("views", v.key);
              const count = facets?.views?.find((f) => f.key === v.key)?.count;
              const missing = facets && count === undefined;
              const label = t(v.labelKey, locale);
              return (
                <Tooltip key={v.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleMulti("views", v.key)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-ui",
                        active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                      )}
                    >
                      {label}
                      {count !== undefined && <span className="ml-1 text-xs text-muted-foreground/60">{count}</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {missing
                      ? t("search.filters.viewMissing", locale).replace("{view}", label)
                      : t("search.filters.viewCount", locale).replace("{n}", String(count ?? 0)).replace("{view}", label)}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Furnishing */}
      {!isProjects && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.furnishing", locale)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {FURNISHING_OPTIONS.map((f) => {
              const active = activeMulti("furnishing", f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleMulti("furnishing", f.key)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {t(f.labelKey, locale)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* AED/sqft bounds */}
      {!isProjects && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.ppsf", locale)}</legend>
          <div className="grid grid-cols-2 gap-2">
            {numInput("ppsf-min", "ppsfMin", "search.filters.ppsf.min", t("search.filters.min", locale), 1)}
            {numInput("ppsf-max", "ppsfMax", "search.filters.ppsf.max", t("search.filters.max", locale), 1)}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {isRent ? t("search.filters.ppsf.noteRent", locale) : t("search.filters.ppsf.note", locale)}
          </p>
        </fieldset>
      )}

      {/* Modeled gross yield (buy / off-plan investment contexts) */}
      {(mode === "buy" || isOffplan) && (
        <fieldset>
          <legend className="kicker mb-2.5 flex items-center gap-1.5">
            {t("search.filters.yield", locale)}
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {t("search.filters.yield.note", locale)}
              </TooltipContent>
            </Tooltip>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {[6, 7, 8].map((y) => {
              const active = query.yieldMin === String(y);
              return (
                <button
                  key={y}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam({ yieldMin: active ? undefined : String(y) })}
                  className={cn(
                    "min-w-11 rounded-md border px-3 py-1.5 text-sm font-medium transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {y}%+
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Handover year range (off-plan mode) */}
      {isOffplan && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.handover", locale)}</legend>
          <div className="grid grid-cols-2 gap-2">
            {numInput("handover-from", "handoverFrom", "search.filters.handover.from", t("search.filters.handover.from", locale), 2020)}
            {numInput("handover-to", "handoverTo", "search.filters.handover.to", t("search.filters.handover.to", locale), 2020)}
          </div>
        </fieldset>
      )}

      {/* Payment plan (off-plan mode) */}
      {isOffplan && (
        <fieldset>
          <legend className="kicker mb-2.5">{t("search.filters.paymentPlan", locale)}</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { v: "1", labelKey: "search.filters.paymentPlan.postHandover" },
              { v: "0", labelKey: "search.filters.paymentPlan.noPostHandover" },
            ].map((o) => {
              const active = query.postHandover === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParam({ postHandover: active ? undefined : o.v })}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs font-medium leading-snug transition-ui",
                    active ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  )}
                >
                  {t(o.labelKey, locale)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Features */}
      {!isProjects && (
        <fieldset className="space-y-3">
          <legend className="kicker mb-2.5">{t("search.filters.features", locale)}</legend>
          {mode === "buy" && (
            <div className="flex items-center justify-between">
              <Label htmlFor="sw-offPlan" className="text-sm font-normal">
                {t("search.filters.offPlanOnly", locale)}
              </Label>
              <Switch id="sw-offPlan" checked={query.offPlan === "1"} onCheckedChange={(v) => setParam({ offPlan: v ? "1" : "0" })} />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label htmlFor="sw-exclusive" className="text-sm font-normal">
              {t("search.filters.exclusive", locale)}
            </Label>
            <Switch id="sw-exclusive" checked={query.exclusive === "1"} onCheckedChange={(v) => setParam({ exclusive: v ? "1" : undefined })} />
          </div>
        </fieldset>
      )}

      {isProjects && (
        <p className="rounded-lg border border-dashed border-border bg-sand/30 p-3 text-xs leading-relaxed text-muted-foreground">
          {t("search.filters.projectsNote", locale)}
        </p>
      )}

      {/* Clear + methodology */}
      <div className="space-y-3 border-t border-border/60 pt-4">
        {activeFilterCount > 0 && (
          <Button variant="outline" className="w-full gap-1.5" onClick={onClearAll}>
            <Trash2 className="h-4 w-4" aria-hidden /> {t("common.clearFilters", locale)} ({formatNumber(activeFilterCount)})
          </Button>
        )}
        <MethodologyLink locale={locale} className="w-full justify-center" />
      </div>
    </div>
  );
}

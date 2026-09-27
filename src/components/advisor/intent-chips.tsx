"use client";

/**
 * Editable interpreted-intent chips (V2 §22.2).
 *
 * Rendered under a user message after POST /api/search/nl parses it: the
 * interpretation is TRANSPARENT (label + explanation + unmappable criteria)
 * and EDITABLE — each chip toggles in/out of the refined filter set
 * (button + aria-pressed), each removable via its ✕ button, and a
 * "Search with these filters" action re-queries the advisor with the edited
 * criteria phrased deterministically by filtersToRefineQuery().
 */
import * as React from "react";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { X, SlidersHorizontal, ArrowRight, Loader2 } from "lucide-react";
import { filtersToChips, filtersToRefineQuery, type IntentFilterSet } from "./intent-format";

export function IntentChips({
  filters,
  explanation,
  unrecognized,
  locale,
  onRefine,
  busy,
}: {
  filters: IntentFilterSet;
  explanation?: string;
  unrecognized?: string[];
  locale: Locale;
  onRefine: (query: string) => void;
  busy?: boolean;
}) {
  const initial = filtersToChips(filters, locale);
  const [active, setActive] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(initial.map((c) => [c.key, true]))
  );
  const [removed, setRemoved] = React.useState<Record<string, boolean>>({});

  const chips = initial.filter((c) => !removed[c.key]);
  const changed = chips.some((c) => !active[c.key]) || Object.values(removed).some(Boolean);

  if (!initial.length) return null;

  const toggle = (key: string) => setActive((m) => ({ ...m, [key]: !m[key] }));
  const remove = (key: string) => {
    setRemoved((m) => ({ ...m, [key]: true }));
    setActive((m) => ({ ...m, [key]: false }));
  };

  const refine = () => {
    const edited: IntentFilterSet = { ...filters };
    const keep = (key: string) => active[key] && !removed[key];
    if (!keep("listingType")) delete edited.listingType;
    edited.communities = (edited.communities ?? []).filter((c) => keep(`community:${c}`));
    if (!edited.communities.length) delete edited.communities;
    edited.propertyTypes = (edited.propertyTypes ?? []).filter((p) => keep(`type:${p}`));
    if (!edited.propertyTypes.length) delete edited.propertyTypes;
    if (!keep("bedroomsMin")) delete edited.bedroomsMin;
    if (!keep("bathroomsMin")) delete edited.bathroomsMin;
    if (!keep("priceMin")) delete edited.priceMin;
    if (!keep("priceMax")) delete edited.priceMax;
    if (!keep("offPlan")) delete edited.offPlan;
    if (!keep("seaView")) delete edited.seaView;
    if (!keep("yieldMin")) {
      delete edited.yieldMinPct;
      delete edited.yieldMin;
    }
    if (!keep("handoverBy")) {
      delete edited.handoverBeforeQuarter;
      delete edited.handoverBy;
    }
    if (!keep("q")) delete edited.q;
    const query = filtersToRefineQuery(edited);
    if (query) onRefine(query);
  };

  return (
    <div className="mt-2 max-w-full rounded-xl border border-dashed border-brand/40 bg-brand-faint/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-strong">
        <SlidersHorizontal className="h-3 w-3" aria-hidden />
        {t("advisorV2.chips.interpreted", locale)}
        <span className="sr-only">{t("advisorV2.chips.srIntro", locale)}</span>
      </p>
      {explanation ? <p className="mt-1 text-[11px] italic leading-relaxed text-muted-foreground">{explanation}</p> : null}
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t("advisorV2.chips.aria", locale)}>
        {chips.map((c) => {
          const isActive = !!active[c.key];
          return (
            <li key={c.key}>
              <div className={cn("inline-flex overflow-hidden rounded-full border transition-ui", isActive ? "border-brand/50 bg-card" : "border-border/60 bg-secondary/60")}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggle(c.key)}
                  title={t("advisorV2.chips.toggleHint", locale)}
                  className={cn(
                    "max-w-[180px] truncate px-2.5 py-1 text-[11px] font-medium transition-ui",
                    isActive ? "text-foreground hover:bg-brand-soft" : "text-muted-foreground line-through decoration-muted-foreground/50"
                  )}
                >
                  {c.label}
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.key)}
                  aria-label={t("advisorV2.chips.removeA11y", locale).replace("{f}", c.label)}
                  className="border-s border-border/60 px-1.5 text-muted-foreground transition-ui hover:bg-warning/10 hover:text-warning"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {unrecognized?.length ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {t("advisorV2.chips.unmapped", locale)}: {unrecognized.join(", ")}
        </p>
      ) : null}
      {changed && (
        <button
          type="button"
          onClick={refine}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-ui hover:bg-brand-strong disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ArrowRight className="h-3 w-3" aria-hidden />}
          {t("advisorV2.chips.refine", locale)}
        </button>
      )}
    </div>
  );
}

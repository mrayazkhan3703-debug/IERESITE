"use client";

import * as React from "react";
import { navigate, useRoute } from "@/lib/router";
import { api, qs } from "@/lib/api-client";
import { events } from "@/lib/analytics-tracker";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, Building2, MapPin, Home, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatAEDPrecise } from "@/lib/format-precise";
import { localeOf, t } from "@/lib/i18n";

interface Suggestion {
  kind: "community" | "project" | "developer" | "property";
  label: string;
  sublabel?: string;
  slug: string;
  count?: number;
}

/** One parsed natural-language criterion, rendered as an editable chip (V2 §11.1). */
export interface NlFilterChip {
  /** Stable id — also used as the analytics key on removal. */
  id: string;
  /** Chips of the same group merge into one comma-joined query param. */
  group?: "community" | "propertyType";
  /** Query param name for /properties (absent for not-applied chips). */
  param?: string;
  /** Query param value. */
  value?: string;
  /** Human-readable chip label. */
  label: string;
  /** false = understood but not representable as a search filter (shown muted). */
  applied: boolean;
  /** Tooltip explaining why a chip is not applied. */
  note?: string;
}

const NOT_APPLICABLE_NOTE_FALLBACK = "Understood, but not representable as a search filter yet — refine manually in results.";

/** Convert an /api/search/nl response into editable chips (never fabricates a filter). */
export function nlChipsFromFilters(
  filters: Record<string, unknown>,
  unrecognized: string[],
  locale: "en" | "ar" = "en"
): NlFilterChip[] {
  const chips: NlFilterChip[] = [];
  const f = filters as Record<string, string | number | boolean | string[] | undefined>;
  const notApplicableNote = t("search.nl.notApplicable", locale) || NOT_APPLICABLE_NOTE_FALLBACK;

  if (typeof f.q === "string" && f.q.trim()) {
    chips.push({ id: "q", param: "q", value: f.q.slice(0, 120), label: `“${f.q.slice(0, 40)}${f.q.length > 40 ? "…" : ""}”`, applied: true });
  }
  if (f.listingType === "RENT" || f.listingType === "SHORT_TERM") {
    chips.push({ id: "listingType", param: "type", value: f.listingType.toLowerCase(), label: t(f.listingType === "SHORT_TERM" ? "advisorV2.chip.shortTerm" : "search.nl.forRent", locale), applied: true });
  }
  if (Array.isArray(f.communities)) {
    f.communities.forEach((c, i) =>
      chips.push({ id: `community:${c}`, group: "community", value: String(c), label: String(c), applied: true })
    );
  }
  if (Array.isArray(f.propertyTypes)) {
    f.propertyTypes.forEach((p) =>
      chips.push({
        id: `propertyType:${p}`,
        group: "propertyType",
        value: String(p).toLowerCase(),
        label: String(p).charAt(0) + String(p).slice(1).toLowerCase(),
        applied: true,
      })
    );
  }
  if (typeof f.priceMin === "number") {
    chips.push({ id: "priceMin", param: "priceMin", value: String(f.priceMin), label: `${t("search.nl.from", locale)} ${formatAEDPrecise(f.priceMin)}`, applied: true });
  }
  if (typeof f.priceMax === "number") {
    chips.push({ id: "priceMax", param: "priceMax", value: String(f.priceMax), label: `${t("search.nl.upTo", locale)} ${formatAEDPrecise(f.priceMax)}`, applied: true });
  }
  if (typeof f.bedroomsMin === "number") {
    chips.push({ id: "bedroomsMin", param: "bedsMin", value: String(f.bedroomsMin), label: `${f.bedroomsMin}+ ${t("search.nl.beds", locale)}`, applied: true });
  }
  if (typeof f.bathroomsMin === "number") {
    chips.push({ id: "bathroomsMin", param: "bathsMin", value: String(f.bathroomsMin), label: `${f.bathroomsMin}+ ${t("search.nl.baths", locale)}`, applied: true });
  }
  if (f.offPlan === true) {
    chips.push({ id: "offPlan", param: "offPlan", value: "1", label: t("search.filters.offPlanOnly", locale), applied: true });
  }
  if (f.seaView === true) {
    chips.push({ id: "seaView", label: t("search.filters.viewType.sea", locale), applied: false, note: notApplicableNote });
  }
  unrecognized.slice(0, 4).forEach((u) =>
    chips.push({ id: `unrecognized:${u}`, label: u, applied: false, note: notApplicableNote })
  );
  return chips;
}

export function SearchBar({
  className,
  listingType = "SALE",
  size = "lg",
  placeholder = "Search by community, project, developer or keyword…",
  /**
   * V2 §11.1 chips mode: submitting a sentence parses it into an editable chip
   * row instead of navigating immediately; the second submit searches with the
   * edited chips. Default (false) preserves the V1 behavior exactly.
   */
  chips = false,
  /** Analytics namespace — pass "hero" to fire the U03 homepage events. */
  eventContext,
  /** U21 i18n: untranslated default broke /ar hero — resolve per-locale below. */
  submitLabel,
  /**
   * V2 §12.1 (U04): persist the search mode through navigation
   * (`?mode=rent|offplan|projects`). When omitted, the legacy `type` mapping
   * from `listingType` applies unchanged.
   */
  mode,
}: {
  className?: string;
  listingType?: "SALE" | "RENT" | "SHORT_TERM";
  size?: "lg" | "md";
  placeholder?: string;
  chips?: boolean;
  eventContext?: string;
  submitLabel?: string;
  mode?: "buy" | "rent" | "offplan" | "projects";
}) {
  const [value, setValue] = React.useState("");
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [nlLoading, setNlLoading] = React.useState(false);
  const [nlChips, setNlChips] = React.useState<NlFilterChip[]>([]);
  const [nlExplanation, setNlExplanation] = React.useState<string | null>(null);
  const [parsedFor, setParsedFor] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  /* Locale for the bar's own copy (chips row, toasts, hints). */
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const tt = (key: string) => t(key, locale);
  const resolvedSubmitLabel = submitLabel ?? tt("cta.search");

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  React.useEffect(() => {
    if (value.trim().length < 2) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ items: Suggestion[] }>(`/api/search/autocomplete${qs({ q: value, limit: 6 })}`);
        setItems(res.items);
        setOpen(true);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [value]);

  const goToSearch = (q?: string, community?: string) => {
    events.search({ q, community });
    navigate("/properties", {
      ...(q ? { q } : {}),
      ...(community ? { community } : {}),
      ...(mode
        ? mode !== "buy"
          ? { mode }
          : {}
        : { type: listingType === "SALE" ? undefined : listingType.toLowerCase() }),
    });
  };

  const pick = (s: Suggestion) => {
    setOpen(false);
    setValue(s.label);
    if (s.kind === "community") goToSearch(undefined, s.slug);
    else if (s.kind === "property") navigate(`/properties/${s.slug}`);
    else if (s.kind === "project") navigate(`/projects/${s.slug}`);
    else if (s.kind === "developer") navigate(`/developers/${s.slug}`);
  };

  /* ---- chips mode: search with the edited chip set --------------------- */

  const searchWithChips = (list: NlFilterChip[]) => {
    const applied = list.filter((c) => c.applied);
    const params: Record<string, string> = {};
    const communities: string[] = [];
    const types: string[] = [];
    for (const c of applied) {
      if (c.group === "community" && c.value) communities.push(c.value);
      else if (c.group === "propertyType" && c.value) types.push(c.value);
      else if (c.param && c.value) params[c.param] = c.value;
    }
    events.search({ mode: "nl-chips", filters: applied.map((c) => c.id) });
    navigate("/properties", {
      q: params.q,
      type: mode ? undefined : params.type,
      ...(mode && mode !== "buy" ? { mode } : {}),
      community: communities.join(",") || undefined,
      propertyType: types.join(",") || undefined,
      priceMin: params.priceMin,
      priceMax: params.priceMax,
      bedsMin: params.bedsMin,
      bathsMin: params.bathsMin,
      offPlan: params.offPlan,
      nl: "1",
    });
  };

  const removeChip = (id: string) => {
    setNlChips((cs) => {
      const next = cs.filter((c) => c.id !== id);
      return next;
    });
    if (eventContext === "hero") events.searchFilterChanged("nl-chips", id);
    else events.filter({ source: "nl-chips", key: id });
  };

  const clearChips = () => {
    setNlChips([]);
    setParsedFor(null);
    setNlExplanation(null);
  };

  /* ---- natural-language parse ------------------------------------------ */

  const runNl = async () => {
    if (!value.trim()) return;
    setNlLoading(true);
    if (eventContext === "hero") events.heroSearchStarted("nl");
    else events.search({ mode: "nl", q: value });
    try {
      const res = await api.post<{
        filters: Record<string, unknown>;
        explanation: string;
        unrecognized: string[];
      }>("/api/search/nl", { query: value });
      setNlChips(nlChipsFromFilters(res.filters ?? {}, res.unrecognized ?? [], locale));
      setParsedFor(value.trim());
      setNlExplanation(typeof res.explanation === "string" && res.explanation.trim() ? res.explanation.trim() : null);
      if (res.unrecognized?.length) {
        toast({
          title: tt("search.nl.partialTitle"),
          description: tt("search.nl.partialDesc").replace("{items}", res.unrecognized.join("; ")),
        });
      }
    } catch (err) {
      toast({
        title: tt("search.nl.errorTitle"),
        description: err instanceof Error ? err.message : tt("search.nl.errorDesc"),
        variant: "destructive",
      });
    } finally {
      setNlLoading(false);
    }
  };

  /** chips mode submit: first submit parses; re-submit searches with edits.
   *  Editing the sentence after a parse re-parses (chips refresh). */
  const submitChipsMode = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== parsedFor) {
      void runNl();
      return;
    }
    if (nlChips.length) {
      searchWithChips(nlChips);
      return;
    }
    if (trimmed) goToSearch(trimmed);
  };

  const iconFor = (kind: Suggestion["kind"]) =>
    kind === "community" ? <MapPin className="h-4 w-4" aria-hidden /> :
    kind === "project" ? <Building2 className="h-4 w-4" aria-hidden /> :
    kind === "developer" ? <Building2 className="h-4 w-4" aria-hidden /> :
    <Home className="h-4 w-4" aria-hidden />;

  const appliedChips = nlChips.filter((c) => c.applied);
  const pendingChips = nlChips.filter((c) => !c.applied);

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-border bg-card shadow-sm transition-ui focus-within:border-brand/70 focus-within:ring-2 focus-within:ring-brand/40",
          size === "lg" ? "p-2 pl-4" : "p-1.5 pl-4"
        )}
        role="search"
      >
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (chips) submitChipsMode();
              else if (open && items[0]) pick(items[0]);
              else goToSearch(value);
            }
          }}
          placeholder={placeholder}
          aria-label={tt("search.placeholder")}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 sm:text-base",
            size === "lg" ? "py-2" : "py-1.5"
          )}
        />
        {value && (
          <button
            type="button"
            aria-label={tt("search.clear")}
            onClick={() => { setValue(""); setItems([]); }}
            className="rounded-full p-1.5 text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        {chips ? (
          /* §11.1 hero: one inline primary CTA — first submit parses the
             sentence into chips, the next one searches with the edits.
             Mobile shortens the label so the sentence input keeps room. */
          <Button
            size={size === "lg" ? "default" : "sm"}
            onClick={submitChipsMode}
            disabled={nlLoading || (!value.trim() && !nlChips.length)}
            className="shrink-0 gap-1.5 rounded-full"
            aria-label={resolvedSubmitLabel}
          >
            {nlLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {nlLoading ? (
              tt("search.nl.parsing")
            ) : (
              <>
                <span className="sm:hidden">{tt("search.go")}</span>
                <span className="hidden sm:inline">{resolvedSubmitLabel}</span>
              </>
            )}
          </Button>
        ) : (
          <>
            <Button
              size={size === "lg" ? "default" : "sm"}
              onClick={() => goToSearch(value)}
              className="shrink-0 rounded-full"
            >
              {tt("search.go")}
            </Button>
            <Button
              variant="outline"
              size={size === "lg" ? "default" : "sm"}
              onClick={runNl}
              disabled={nlLoading}
              className="hidden shrink-0 gap-1.5 rounded-full sm:inline-flex"
              title={tt("search.nl.askAiTip")}
            >
              {nlLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4 text-brand" aria-hidden />}
              {tt("search.nl.askAi")}
            </Button>
          </>
        )}
      </div>

      {/* Suggestions */}
      {open && items.length > 0 && !chips && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg" role="listbox" aria-label={tt("search.suggestions")}>
          {items.map((s, i) => (
            <button
              key={`${s.kind}-${s.slug}-${i}`}
              type="button"
              role="option"
              aria-selected={i === 0}
              onClick={() => pick(s)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-ui hover:bg-secondary"
            >
              <span className="text-muted-foreground">{iconFor(s.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.label}</span>
                {s.sublabel && <span className="block truncate text-xs text-muted-foreground">{s.sublabel}</span>}
              </span>
              {s.count !== undefined && (
                <span className="num shrink-0 text-xs text-muted-foreground">{s.count} {tt("search.suggestionListings")}</span>
              )}
              <span className="sr-only">{s.kind}</span>
            </button>
          ))}
          <div className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
            {tt("search.suggestionsEnter")} <kbd className="rounded border border-border bg-secondary px-1">Enter</kbd>
          </div>
        </div>
      )}

      {/* V2 §11.1 — editable chips parsed from the submitted sentence. */}
      {chips && nlChips.length > 0 && (
        <div className="mt-3 rounded-2xl border border-border bg-popover p-3.5 shadow-lg">
          <p className="text-xs text-muted-foreground">{tt("search.nl.info")}</p>
          {nlExplanation && (
            <p className="mt-1 text-xs italic text-muted-foreground/85">
              <span className="font-medium not-italic">{tt("search.nl.understood")}:</span> {nlExplanation}
            </p>
          )}
          {appliedChips.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={tt("search.nl.applied")}>
              {appliedChips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    onClick={() => removeChip(chip.id)}
                    aria-label={`${tt("search.nl.remove")}: ${chip.label}`}
                    className="group/chip inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-faint px-3 py-1.5 text-sm font-medium text-brand-strong transition-ui hover:border-brand/70 hover:bg-brand-soft"
                  >
                    {chip.label}
                    <X className="h-3.5 w-3.5 opacity-60 transition-ui group-hover/chip/opacity-100" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pendingChips.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={tt("search.nl.pending")}>
              {pendingChips.map((chip) => (
                <li key={chip.id}>
                  <span
                    title={chip.note}
                    className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-dashed border-border bg-secondary px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    {chip.label}
                    <span className="sr-only">{tt("search.nl.notApplied")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={clearChips}
              className="text-xs font-medium text-muted-foreground underline-offset-2 transition-ui hover:text-foreground hover:underline"
            >
              {tt("search.nl.clearAll")}
            </button>
            <Button size="sm" className="rounded-full" onClick={() => searchWithChips(nlChips)}>
              <Search className="h-3.5 w-3.5" aria-hidden /> {tt("search.nl.searchWith")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Smart filters (V2 §12.6, U04) — quick computed-filter chips.
 * Every filter is computed server-side by the search service and carries a
 * documented methodology (Dialog below). Chips disclose when a figure is
 * MODELED or derived from the community name — never presented as fact.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { events } from "@/lib/analytics-tracker";

export type SmartKey = "below_median" | "waterfront" | "high_yield" | "handover_soon";

interface SmartFilterDef {
  key: SmartKey;
  labelKey: string;
  tipKey: string;
  /** Honesty tag rendered on the chip. */
  tag?: "modeled" | "derived";
}

export const SMART_FILTERS: SmartFilterDef[] = [
  { key: "below_median", labelKey: "search.smart.belowMedian", tipKey: "search.smart.belowMedian.tip", tag: "modeled" },
  { key: "waterfront", labelKey: "search.smart.waterfront", tipKey: "search.smart.waterfront.tip", tag: "derived" },
  { key: "high_yield", labelKey: "search.smart.highYield", tipKey: "search.smart.highYield.tip", tag: "modeled" },
  { key: "handover_soon", labelKey: "search.smart.handoverSoon", tipKey: "search.smart.handoverSoon.tip" },
];

export function activeSmartKeys(smartParam: string | undefined): SmartKey[] {
  return (smartParam ?? "").split(",").filter(Boolean) as SmartKey[];
}

function SmartChip({
  def,
  active,
  disabled,
  disabledReason,
  onToggle,
  locale,
}: {
  def: SmartFilterDef;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: () => void;
  locale: Locale;
}) {
  const label = t(def.labelKey, locale);
  const tip = disabledReason ?? t(def.tipKey, locale);
  const chip = (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-ui",
        disabled && "cursor-not-allowed opacity-50",
        active
          ? "border-brand bg-brand-soft text-brand-strong"
          : "border-border bg-card text-muted-foreground hover:border-brand/50 hover:text-foreground"
      )}
    >
      {label}
      {def.tag === "modeled" && (
        <span className="rounded-[3px] bg-secondary px-1 py-px text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("search.smart.modeled", locale)}
        </span>
      )}
      {def.tag === "derived" && (
        <span
          title={t("search.smart.derived", locale)}
          className="rounded-[3px] bg-secondary px-1 py-px text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
        >
          {t("search.smart.derivedTag", locale)}
        </span>
      )}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
        <p>{tip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function SmartFilterChips({
  smartParam,
  onToggle,
  locale,
  mode,
  className,
}: {
  /** Current `smart` URL param value. */
  smartParam: string | undefined;
  onToggle: (key: SmartKey) => void;
  locale: Locale;
  /** Handover-soon is an off-plan concept — shown only in offplan mode. */
  mode: "buy" | "rent" | "offplan" | "projects";
  className?: string;
}) {
  const active = activeSmartKeys(smartParam);
  const visible = SMART_FILTERS.filter((f) => f.key !== "handover_soon" || mode === "offplan");

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label={t("search.filters.smart", locale)}>
      {visible.map((def) => (
        <SmartChip
          key={def.key}
          def={def}
          active={active.includes(def.key)}
          /* Below-area-median compares asking AED/sqft against the community's
             modeled SALE benchmark — there is no per-sqft rent benchmark, so in
             rent mode the chip stays off with an honest tooltip (never a fake
             100%-match filter). */
          disabled={def.key === "below_median" && mode === "rent"}
          disabledReason={
            def.key === "below_median" && mode === "rent" ? t("search.smart.belowMedian.rentUnavailable", locale) : undefined
          }
          onToggle={() => {
            events.searchFilterChanged("smart-chip", def.key);
            onToggle(def.key);
          }}
          locale={locale}
        />
      ))}
      <MethodologyLink locale={locale} />
    </div>
  );
}

/** Compact "Methodology" trigger — also used at the filter-panel bottom. */
export function MethodologyLink({ locale, className }: { locale: Locale; className?: string }) {
  return (
    <SmartMethodologyDialog locale={locale}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 transition-ui hover:text-brand-strong hover:underline",
          className
        )}
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        {t("search.methodology.link", locale)}
      </button>
    </SmartMethodologyDialog>
  );
}

export function SmartMethodologyDialog({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-4 w-4 text-brand" aria-hidden />
            {t("search.methodology.title", locale)}
          </DialogTitle>
          <DialogDescription>{t("search.methodology.intro", locale)}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4">
          {SMART_FILTERS.map((def) => (
            <div key={def.key} className="rounded-lg border border-border bg-sand/30 p-3.5">
              <dt className="text-sm font-semibold">{t(def.labelKey, locale)}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(def.tipKey, locale)}</dd>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-border p-3.5 text-xs text-muted-foreground">
            {t("search.filters.yield.note", locale)}
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

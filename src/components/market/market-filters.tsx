"use client";

/**
 * Synchronized filter bar (U10 §19.3) — one filter state drives EVERY surface
 * of the explorer (chips, charts, tables, export). Sticky under the site
 * header on desktop; inline on mobile so it never covers content. Every
 * control is a labelled form control (a11y §52).
 */

import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, RotateCcw, Link2 } from "lucide-react";
import { t, localeOf } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { formatDate, formatNumber } from "@/lib/money";
import type { MarketAgg } from "./market-types";
import { cn } from "@/lib/utils";

export type MarketPeriod = "all" | "m12" | "m6" | "m3";

export interface MarketFilterState {
  period: MarketPeriod;
  community: string;
  propertyType: string;
  bedrooms: string;
  regType: string;
}

export const DEFAULT_FILTERS: MarketFilterState = {
  period: "all",
  community: "",
  propertyType: "",
  bedrooms: "all",
  regType: "all",
};

/** Translate filter state into API query params (single source of truth). */
export function filtersToQuery(f: MarketFilterState, variant: "transactions" | "rents"): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.period !== "all") {
    const months = f.period === "m12" ? 12 : f.period === "m6" ? 6 : 3;
    const from = new Date(Date.now() - months * 30.44 * 86400_000);
    params.from = from.toISOString().slice(0, 10);
  }
  if (f.community) params.community = f.community;
  if (f.propertyType) params.propertyType = f.propertyType;
  if (variant === "rents" && f.bedrooms !== "all") params.bedrooms = f.bedrooms;
  if (variant === "transactions" && f.regType !== "all") params.transactionType = f.regType;
  return params;
}

export function isDefaultFilters(f: MarketFilterState): boolean {
  return (
    f.period === "all" &&
    f.community === "" &&
    f.propertyType === "" &&
    f.bedrooms === "all" &&
    f.regType === "all"
  );
}

/* V3-F §57 — shareable explorer state: the filter bar persists to the URL
 * (?period=&community=&type=&beds=&reg=) so a filtered view is shareable and
 * survives reload. Raw filter values (not the derived API `from` date). */

const URL_PERIODS = new Set(["all", "m12", "m6", "m3"]);
const URL_REG_TYPES = new Set(["all", "SALE", "MORTGAGE", "GIFT"]);

export function filtersFromQuery(query: Record<string, string>, variant: "transactions" | "rents"): Partial<MarketFilterState> {
  const patch: Partial<MarketFilterState> = {};
  if (URL_PERIODS.has(query.period)) patch.period = query.period as MarketPeriod;
  if (typeof query.community === "string" && query.community) patch.community = query.community;
  if (typeof query.type === "string" && query.type) patch.propertyType = query.type;
  if (variant === "rents" && typeof query.beds === "string" && /^\d+$/.test(query.beds)) patch.bedrooms = query.beds;
  if (variant === "transactions" && URL_REG_TYPES.has(query.reg)) patch.regType = query.reg;
  return patch;
}

export function filtersToUrlParams(f: MarketFilterState, variant: "transactions" | "rents"): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.period !== "all") params.period = f.period;
  if (f.community) params.community = f.community;
  if (f.propertyType) params.type = f.propertyType;
  if (variant === "rents" && f.bedrooms !== "all") params.beds = f.bedrooms;
  if (variant === "transactions" && f.regType !== "all") params.reg = f.regType;
  return params;
}

export function MarketFilters({
  variant,
  filters,
  onChange,
  agg,
}: {
  variant: "transactions" | "rents";
  filters: MarketFilterState;
  onChange: (next: MarketFilterState) => void;
  agg: MarketAgg | null;
}) {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);
  const isTx = variant === "transactions";

  const set = (patch: Partial<MarketFilterState>) => onChange({ ...filters, ...patch });

  const periods: { value: MarketPeriod; label: string }[] = [
    { value: "all", label: t_("market.filters.period.all") },
    { value: "m12", label: t_("market.filters.period.m12") },
    { value: "m6", label: t_("market.filters.period.m6") },
    { value: "m3", label: t_("market.filters.period.m3") },
  ];

  const areas = agg?.filterOptions.areas ?? [];
  const types = agg?.filterOptions.propertyTypes ?? [];
  const bedOptions = agg?.byBedrooms ?? [];

  return (
    <div
      className={cn(
        "sticky top-[57px] z-30 -mx-4 mb-6 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:top-[64px] sm:rounded-xl sm:border sm:bg-card sm:px-4 sm:shadow-sm"
      )}
      aria-label={t_("market.filters.synced")}
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
        <p className="flex w-full items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:w-auto sm:pt-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> {t_("market.filters.synced")}
        </p>

        <div className="min-w-0 flex-1 basis-[calc(50%-0.75rem)] space-y-1 sm:basis-auto">
          <Label htmlFor="mf-period" className="text-[11px] text-muted-foreground">
            {t_("market.filters.period")}
          </Label>
          <Select value={filters.period} onValueChange={(v) => set({ period: v as MarketPeriod })}>
            <SelectTrigger id="mf-period" className="min-h-11 w-full text-base sm:min-h-0 sm:w-[130px] sm:text-sm" aria-label={t_("market.filters.period")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 flex-1 basis-[calc(50%-0.75rem)] space-y-1 sm:basis-auto">
          <Label htmlFor="mf-community" className="text-[11px] text-muted-foreground">
            {t_("market.filters.community")}
          </Label>
          <Select value={filters.community || "all"} onValueChange={(v) => set({ community: v === "all" ? "" : v })}>
            <SelectTrigger id="mf-community" className="min-h-11 w-full text-base sm:min-h-0 sm:w-[150px] sm:text-sm" aria-label={t_("market.filters.community")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t_("market.filters.community.all")}</SelectItem>
              {areas.map((a) => (
                <SelectItem key={a.areaName} value={a.areaName}>
                  {a.areaName} ({formatNumber(a.count)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 flex-1 basis-[calc(50%-0.75rem)] space-y-1 sm:basis-auto">
          <Label htmlFor="mf-type" className="text-[11px] text-muted-foreground">
            {t_("market.filters.type")}
          </Label>
          <Select value={filters.propertyType || "all"} onValueChange={(v) => set({ propertyType: v === "all" ? "" : v })}>
            <SelectTrigger id="mf-type" className="min-h-11 w-full text-base sm:min-h-0 sm:w-[130px] sm:text-sm" aria-label={t_("market.filters.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t_("market.filters.type.all")}</SelectItem>
              {types.map((ty) => (
                <SelectItem key={ty.type} value={ty.type}>
                  {ty.type} ({formatNumber(ty.count)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {variant === "rents" && (
          <div className="min-w-0 flex-1 basis-[calc(50%-0.75rem)] space-y-1 sm:basis-auto">
            <Label htmlFor="mf-beds" className="text-[11px] text-muted-foreground">
              {t_("market.filters.beds")}
            </Label>
            <Select value={filters.bedrooms} onValueChange={(v) => set({ bedrooms: v })}>
              <SelectTrigger id="mf-beds" className="min-h-11 w-full text-base sm:min-h-0 sm:w-[110px] sm:text-sm" aria-label={t_("market.filters.beds")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t_("market.filters.beds.all")}</SelectItem>
                {bedOptions.map((b) => (
                  <SelectItem key={b.bedrooms} value={String(b.bedrooms)}>
                    {b.bedrooms === 0
                      ? t_("market.filters.beds.studio")
                      : t_("market.filters.beds.n").replace("{n}", String(b.bedrooms))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isTx && (
          <div className="min-w-0 flex-1 basis-[calc(50%-0.75rem)] space-y-1 sm:basis-auto">
            <Label htmlFor="mf-reg" className="text-[11px] text-muted-foreground">
              {t_("market.filters.regType")}
            </Label>
            <Select value={filters.regType} onValueChange={(v) => set({ regType: v })}>
              <SelectTrigger id="mf-reg" className="min-h-11 w-full text-base sm:min-h-0 sm:w-[130px] sm:text-sm" aria-label={t_("market.filters.regType")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t_("market.filters.regType.all")}</SelectItem>
                {["SALE", "MORTGAGE", "GIFT"].map((rt) => (
                  <SelectItem key={rt} value={rt}>
                    {rt.charAt(0) + rt.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 pt-1">
          {!isDefaultFilters(filters) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 gap-1.5 px-2.5 text-xs text-muted-foreground sm:h-9"
              onClick={() => onChange({ ...DEFAULT_FILTERS })}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t_("market.filters.reset")}
            </Button>
          )}
        </div>
      </div>

      {agg?.dateMin && agg.dateMax && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Link2 className="h-3 w-3 shrink-0" aria-hidden />
          {t_("market.filters.coverage")
            .replace("{from}", formatDate(agg.dateMin))
            .replace("{to}", formatDate(agg.dateMax))}
        </p>
      )}
    </div>
  );
}

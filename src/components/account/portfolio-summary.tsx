"use client";

/**
 * Portfolio summary (V2 §25.1, U15): KPI cards for value / cost / equity /
 * rent / net income / yields. Every modeled figure carries a DataStateBadge
 * (MODELED) or a "user input" chip — the verified/modeled layering the spec
 * requires; nothing implies a certified valuation.
 */
import { DataStateBadge, UnavailableValue } from "@/components/common";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { t, localeOf } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Briefcase, Wallet, Landmark, CalendarRange, PiggyBank, Percent } from "lucide-react";
import type { PortfolioData } from "./portfolio-types";

export function PortfolioSummary({ data }: { data: PortfolioData }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const major = (m: string | null) => (m === null ? null : Number(m) / 100);
  const modeled = data.totals.holdingsCount > 0;

  const cards: {
    key: string;
    icon: typeof Briefcase;
    label: string;
    value: string;
    tooltip?: string;
    badge?: "MODELED" | "USER_INPUT";
    hint?: string;
  }[] = [
    {
      key: "value",
      icon: Briefcase,
      label: t_("portfolio.summary.value"),
      value: modeled ? formatAEDPrecise(major(data.totals.valueMinor) ?? 0) : "—",
      tooltip: modeled ? fullValueTooltip(major(data.totals.valueMinor) ?? 0) : undefined,
      badge: modeled ? "MODELED" : undefined,
      hint: "Modeled — asking price where listed, else community AED/sqft, else your purchase price.",
    },
    {
      key: "cost",
      icon: Wallet,
      label: t_("portfolio.summary.cost"),
      value: modeled ? formatAEDPrecise(major(data.totals.acquisitionCostMinor) ?? 0) : "—",
      tooltip: modeled ? fullValueTooltip(major(data.totals.acquisitionCostMinor) ?? 0) : undefined,
    },
    {
      key: "equity",
      icon: Landmark,
      label: t_("portfolio.summary.equity"),
      value: data.totals.equityMinor !== null ? formatAEDPrecise(major(data.totals.equityMinor) ?? 0) : "—",
      tooltip: data.totals.equityMinor !== null ? fullValueTooltip(major(data.totals.equityMinor) ?? 0) : undefined,
      badge: data.totals.equityMinor !== null ? "MODELED" : undefined,
      hint: data.totals.equityMinor !== null ? "Modeled value minus mortgage balances you entered." : "No mortgage data entered.",
    },
    {
      key: "rent",
      icon: CalendarRange,
      label: t_("portfolio.summary.rent"),
      value: data.totals.annualRentMinor !== null ? formatAEDPrecise(major(data.totals.annualRentMinor) ?? 0) : "—",
      tooltip: data.totals.annualRentMinor !== null ? fullValueTooltip(major(data.totals.annualRentMinor) ?? 0) : undefined,
    },
    {
      key: "netIncome",
      icon: PiggyBank,
      label: t_("portfolio.summary.netIncome"),
      value: modeled ? formatAEDPrecise(major(data.totals.netIncomeMinor) ?? 0) : "—",
      tooltip: modeled ? fullValueTooltip(major(data.totals.netIncomeMinor) ?? 0) : undefined,
      badge: modeled ? "MODELED" : undefined,
      hint: "After mortgage service and the engine's documented default operating costs.",
    },
    {
      key: "grossYield",
      icon: Percent,
      label: t_("portfolio.summary.grossYield"),
      value: data.totals.grossYieldPct !== null ? formatPctPrecise(data.totals.grossYieldPct) : "—",
      badge: data.totals.grossYieldPct !== null ? "MODELED" : undefined,
    },
    {
      key: "netYield",
      icon: Percent,
      label: t_("portfolio.summary.netYield"),
      value: data.totals.netYieldPct !== null ? formatPctPrecise(data.totals.netYieldPct) : "—",
      badge: data.totals.netYieldPct !== null ? "MODELED" : undefined,
    },
  ];

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className="rounded-xl border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <c.icon className="h-3.5 w-3.5 text-brand" aria-hidden />
                {c.label}
              </p>
              {c.badge === "MODELED" && <DataStateBadge state="MODELED" />}
            </div>
            <p
              className={cn("num mt-2 font-display text-xl font-semibold text-ink")}
              title={c.tooltip ?? undefined}
            >
              {c.value}
            </p>
            {c.hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">{c.hint}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {data.assumptions.note}
      </p>
    </div>
  );
}

/** Honest basis chip for a single holding's valuation. */
export function ValuationBasisChip({ basis }: { basis: string }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const label =
    basis === "ASKING_PRICE"
      ? t_("portfolio.modeled") + " · asking"
      : basis === "COMMUNITY_METRIC"
        ? t_("portfolio.modeled") + " · community metric"
        : t_("portfolio.userProvided");
  const tone =
    basis === "PURCHASE_PRICE"
      ? "border-border bg-secondary text-muted-foreground"
      : "border-brand/40 bg-brand-soft text-brand-strong";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

export { UnavailableValue };

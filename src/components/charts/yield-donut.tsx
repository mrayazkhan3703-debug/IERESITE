"use client";

import * as React from "react";
import { useRoute } from "@/lib/router";
import { localeOf } from "@/lib/i18n";
import { calculatorCopy } from "@/lib/calculator-copy";
import { formatMoney } from "@/lib/money";

/**
 * Donut decomposition of gross annual rent for the yield calculator:
 * net operating income, running costs and vacancy loss.
 * Pure inline SVG (same rationale as Sparkline — cheap, no library weight).
 * Deterministic: values come from the same calculator inputs, nothing inferred.
 */
export function YieldDonut({
  grossYieldPct,
  netYieldPct,
  annualRent,
  annualCosts,
  vacancyLoss,
}: {
  grossYieldPct: number;
  netYieldPct: number;
  annualRent: number;
  annualCosts: number;
  vacancyLoss: number;
}) {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  const netIncome = Math.max(0, annualRent - vacancyLoss - annualCosts);
  const total = Math.max(annualRent, netIncome + annualCosts + vacancyLoss, 1);

  const R = 54;
  const C = 2 * Math.PI * R;
  const seg = (v: number) => (Math.max(0, v) / total) * C;

  const segNet = seg(netIncome);
  const segCosts = seg(annualCosts);
  const segVac = seg(vacancyLoss);
  // stroke segments drawn clockwise from 12 o'clock via rotation
  const rotation = -90;

  const legend = [
    { color: "stroke-success", fill: "fill-success", label: c("Net operating income"), value: netIncome },
    { color: "stroke-warning", fill: "fill-warning", label: c("Running costs"), value: annualCosts },
    { color: "stroke-muted-foreground/40", fill: "fill-muted-foreground/40", label: c("Vacancy loss"), value: vacancyLoss },
  ];

  return (
    <div className="flex flex-wrap items-center gap-6 sm:flex-nowrap">
      <svg
        viewBox="0 0 140 140"
        width={140}
        height={140}
        role="img"
        aria-label={`${c("Annual rent decomposition")}: ${c("Net operating income")} ${formatMoney(String(Math.round(netIncome) * 100), { currency: "AED", compact: true })}, ${c("Running costs")} ${formatMoney(String(Math.round(annualCosts) * 100), { currency: "AED", compact: true })}, ${c("Vacancy loss")} ${formatMoney(String(Math.round(vacancyLoss) * 100), { currency: "AED", compact: true })}. ${c("Gross yield")} ${grossYieldPct.toFixed(2)}%, ${c("Net yield")} ${netYieldPct.toFixed(2)}%.`}
        focusable="false"
        className="shrink-0"
      >
        {/* track */}
        <circle cx={70} cy={70} r={R} fill="none" strokeWidth={16} className="stroke-border/60" />
        {/* net income */}
        <circle
          cx={70}
          cy={70}
          r={R}
          fill="none"
          strokeWidth={16}
          strokeLinecap="butt"
          className="stroke-success transition-all duration-300"
          strokeDasharray={`${segNet} ${C - segNet}`}
          transform={`rotate(${rotation} 70 70)`}
        />
        {/* costs */}
        <circle
          cx={70}
          cy={70}
          r={R}
          fill="none"
          strokeWidth={16}
          strokeLinecap="butt"
          className="stroke-warning transition-all duration-300"
          strokeDasharray={`${segCosts} ${C - segCosts}`}
          strokeDashoffset={-segNet}
          transform={`rotate(${rotation} 70 70)`}
        />
        {/* vacancy */}
        <circle
          cx={70}
          cy={70}
          r={R}
          fill="none"
          strokeWidth={16}
          strokeLinecap="butt"
          className="stroke-muted-foreground/40 transition-all duration-300"
          strokeDasharray={`${segVac} ${C - segVac}`}
          strokeDashoffset={-(segNet + segCosts)}
          transform={`rotate(${rotation} 70 70)`}
        />
        <text direction="ltr" x={70} y={66} textAnchor="middle" className="fill-foreground font-display text-[20px] font-semibold">
          {netYieldPct.toFixed(1)}%
        </text>
        <text x={70} y={82} textAnchor="middle" className="fill-muted-foreground text-[9px] font-medium uppercase tracking-wide">
          {c("Net yield")}
        </text>
      </svg>

      <div className="min-w-0 flex-1 space-y-2.5">
        {legend.map((l) => (
          <div key={l.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.fill}`} aria-hidden />
              <span className="truncate">{l.label}</span>
            </span>
            <span dir="ltr" className="num font-semibold text-foreground">
              {formatMoney(String(Math.round(l.value) * 100), { currency: "AED", compact: true })}
            </span>
          </div>
        ))}
        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
          {c("Gross yield")} {grossYieldPct.toFixed(2)}% · computed from the inputs above — deterministic scenario, not a guarantee.
        </p>
      </div>
    </div>
  );
}

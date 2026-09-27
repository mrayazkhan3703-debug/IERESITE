"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import * as calc from "@/lib/calculators";
import { formatMoney } from "@/lib/money";
import { ArrowRight, Info } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

/** Compact mortgage affordability estimate embedded on property detail.
 *  Deterministic (same math as the mortgage calculator); assumptions are labeled per PART T.
 *  DEV-C: all strings localized (en/ar) — closes the U06 documented omission. */
export function AffordabilityWidget({
  priceMinor,
  currency = "AED",
  locale = "en",
}: {
  priceMinor: string;
  currency?: string;
  locale?: Locale;
}) {
  const price = Number(priceMinor) / 100;
  const [downPct, setDownPct] = React.useState(20);
  const [rate, setRate] = React.useState(4.5);
  const [term, setTerm] = React.useState(25);

  const r = React.useMemo(
    () => calc.mortgageSchedule({ propertyPrice: price, downPaymentPct: downPct, interestRatePct: rate, years: term }),
    [price, downPct, rate, term]
  );

  return (
    <div className="rounded-xl border border-brand/25 bg-brand-faint/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{t("property.afford.title", locale)}</h3>
        <span className="num text-xs text-muted-foreground">
          {t("property.afford.onPrice", locale)} {formatMoney(priceMinor, { currency, compact: true })}
        </span>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("property.afford.monthly", locale)}
        </span>
        <span className="num font-display text-2xl font-semibold text-brand-strong">
          {formatMoney(String(Math.round(r.monthlyPayment * 100)), { currency })}
        </span>
        <span className="text-sm text-muted-foreground">{t("property.afford.perMonth", locale)}</span>
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="aff-down" className="text-xs">
            {t("property.afford.down", locale)}: <span className="num font-semibold text-foreground">{downPct}%</span>
          </Label>
          <Slider id="aff-down" thumbLabels={[t("property.afford.down", locale)]} value={[downPct]} min={10} max={80} step={5} onValueChange={([v]) => setDownPct(v)} />
          <p className="num text-[11px] text-muted-foreground">{formatMoney(String(Math.round(r.downPayment * 100)), { currency, compact: true })}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="aff-rate" className="text-xs">
            {t("property.afford.rate", locale)}: <span className="num font-semibold text-foreground">{rate.toFixed(2)}%</span>
          </Label>
          <Slider id="aff-rate" thumbLabels={[t("property.afford.rate", locale)]} value={[rate]} min={2} max={10} step={0.05} onValueChange={([v]) => setRate(v)} />
          <p className="text-[11px] text-muted-foreground">{t("property.afford.rateNote", locale)}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="aff-term" className="text-xs">
            {t("property.afford.term", locale)}: <span className="num font-semibold text-foreground">{term} {t("property.afford.yrs", locale)}</span>
          </Label>
          <Slider id="aff-term" thumbLabels={[t("property.afford.term", locale)]} value={[term]} min={5} max={35} step={1} onValueChange={([v]) => setTerm(v)} />
          <p className="num text-[11px] text-muted-foreground">{t("property.afford.loan", locale)} {formatMoney(String(Math.round(r.loanAmount * 100)), { currency, compact: true })}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand/20 pt-3">
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t("property.afford.disclaimer", locale)}
        </p>
        <Link
          to="/calculators/mortgage"
          query={{ price: String(Math.round(price)) }}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-strong transition-ui hover:gap-1.5"
        >
          {t("property.afford.amortization", locale)}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

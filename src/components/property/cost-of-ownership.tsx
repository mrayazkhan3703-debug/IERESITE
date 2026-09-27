"use client";

/**
 * Cost of ownership (V2 §14.9) — explainable estimated-cost panel.
 *
 * One-time acquisition costs (purchase price, 4% DLD transfer fee + 0.25%
 * registration trustee fee — "standard Dubai rates, verify at purchase"),
 * a mortgage assumption summary from the scenario engine's mortgageProfile,
 * and recurring annual costs (service charge from listing facts × area,
 * maintenance + management assumptions).
 *
 * Every derived figure is badged MODELED; the panel ends with the mandatory
 * "Estimates only — not professional advice" line.
 */

import * as React from "react";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { mortgageProfile } from "@/lib/scenario-engine";
import { formatAEDPrecise, formatAEDPreciseMonthly, formatPctPrecise, fullValueTooltip, fullValueTooltipMonthly } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { Link } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { YIELD_MODEL_ASSUMPTIONS, type RentBenchmark } from "./detail-shared";
import { Calculator, ChevronDown, Receipt, Wallet } from "lucide-react";

/** Standard Dubai acquisition rates shown in this panel (§14.9). */
const DLD_TRANSFER_FEE_PCT = 4;
const REGISTRATION_FEE_PCT = 0.25;

export function CostOfOwnership({
  purchasePriceMajor,
  currency = "AED",
  areaSqft,
  serviceChargePerSqft,
  offPlan,
  rentBenchmark,
  locale = "en",
}: {
  purchasePriceMajor: number | null;
  currency?: string;
  areaSqft: number | null;
  serviceChargePerSqft: number | null;
  offPlan: boolean;
  rentBenchmark: RentBenchmark | null;
  locale?: Locale;
}) {
  const [open, setOpen] = React.useState(false);

  const mortgage = React.useMemo(() => {
    if (purchasePriceMajor === null || purchasePriceMajor <= 0) return null;
    return mortgageProfile({
      borrowerCategory: "resident-first",
      propertyPrice: purchasePriceMajor,
      propertyStatus: offPlan ? "offplan" : "ready",
      downPaymentPct: 25,
      annualRatePct: 4.5,
      termYears: 25,
      purpose: "investment",
    });
  }, [purchasePriceMajor, offPlan]);

  const dldFee = purchasePriceMajor !== null ? (purchasePriceMajor * DLD_TRANSFER_FEE_PCT) / 100 : null;
  const regFee = purchasePriceMajor !== null ? (purchasePriceMajor * REGISTRATION_FEE_PCT) / 100 : null;
  const serviceChargeAnnual = serviceChargePerSqft !== null && areaSqft ? serviceChargePerSqft * areaSqft : null;
  const maintenanceAnnual =
    purchasePriceMajor !== null ? (purchasePriceMajor * YIELD_MODEL_ASSUMPTIONS.maintenancePctOfPrice) / 100 : null;
  const managementAnnual =
    rentBenchmark?.medianAnnualRent
      ? rentBenchmark.medianAnnualRent * (YIELD_MODEL_ASSUMPTIONS.managementPct / 100) * (1 - YIELD_MODEL_ASSUMPTIONS.vacancyAllowancePct / 100)
      : null;

  const oneTimeTotal = [dldFee, regFee].reduce<number | null>((acc, v) => (acc === null || v === null ? null : acc + v), 0);
  const annualTotal = [serviceChargeAnnual, maintenanceAnnual, managementAnnual].reduce<number | null>(
    (acc, v) => (v === null ? acc : (acc ?? 0) + v),
    0
  );

  if (purchasePriceMajor === null) return null;

  return (
    <section aria-labelledby="cost-heading">
      <h2 id="cost-heading" className="font-display text-xl font-semibold">
        {t("property.cost.title", locale)}
      </h2>

      {/* Collapsible estimated-cost panel */}
      <div className="mt-4 rounded-xl border border-border/70 bg-card">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="cost-panel-body"
          className="flex w-full items-center justify-between gap-3 p-4 text-left transition-ui hover:bg-secondary/40"
        >
          <span className="flex items-center gap-2.5">
            <Receipt className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <span>
              <span className="text-sm font-semibold">{t("property.cost.panelTitle", locale)}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="num" title={fullValueTooltip(purchasePriceMajor + (oneTimeTotal ?? 0))}>
                  {t("property.cost.totalHint", locale)} {formatAEDPrecise(purchasePriceMajor + (oneTimeTotal ?? 0))}
                </span>
                <DataStateBadge state="MODELED" />
              </span>
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>

        <div id="cost-panel-body" className={open ? "block" : "hidden"}>
          <div className="space-y-5 border-t border-border/60 p-4 sm:p-5">
            {/* One-time acquisition costs */}
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" aria-hidden /> {t("property.cost.oneTime", locale)}
              </p>
              <dl className="mt-2.5 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{t("property.cost.purchasePrice", locale)}</dt>
                  <dd className="num font-medium" title={fullValueTooltip(purchasePriceMajor)}>
                    {formatAEDPrecise(purchasePriceMajor)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("property.cost.dld", locale)} <span className="num">({DLD_TRANSFER_FEE_PCT}%)</span>
                  </dt>
                  <dd className="num font-medium" title={dldFee !== null ? fullValueTooltip(dldFee) : undefined}>
                    {dldFee !== null ? formatAEDPrecise(dldFee) : <UnavailableValue />}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("property.cost.registration", locale)} <span className="num">({REGISTRATION_FEE_PCT}%)</span>
                  </dt>
                  <dd className="num font-medium" title={regFee !== null ? fullValueTooltip(regFee) : undefined}>
                    {regFee !== null ? formatAEDPrecise(regFee) : <UnavailableValue />}
                  </dd>
                </div>
                {oneTimeTotal !== null && (
                  <div className="flex items-baseline justify-between gap-4 border-t border-border/60 pt-2">
                    <dt className="font-medium">{t("property.cost.feesSubtotal", locale)}</dt>
                    <dd className="num font-semibold" title={fullValueTooltip(oneTimeTotal)}>
                      {formatAEDPrecise(oneTimeTotal)}
                    </dd>
                  </div>
                )}
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t("property.cost.standardRates", locale)}
                </p>
              </dl>
            </div>

            {/* Mortgage assumption summary (scenario engine) */}
            {mortgage && (
              <div className="rounded-lg bg-brand-faint/50 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.cost.mortgage", locale)}</p>
                  <DataStateBadge state="MODELED" />
                </div>
                <p className="mt-2 text-sm leading-relaxed">
                  <span className="num">{formatPctPrecise(mortgage.assumptions.downPaymentPct, 0)}</span>{" "}
                  {t("property.cost.down", locale)} ·{" "}
                  <span className="num">{mortgage.assumptions.termYears}</span> {t("property.cost.years", locale)} ·{" "}
                  <span className="num">{formatPctPrecise(mortgage.assumptions.annualRatePct, 2)}</span>{" "}
                  {t("property.cost.fixed", locale)} →{" "}
                  <span className="num font-semibold" title={fullValueTooltipMonthly(mortgage.monthlyPayment)}>
                    {formatAEDPreciseMonthly(mortgage.monthlyPayment)}
                  </span>
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {t("property.cost.ltvNote", locale)} <span className="num">{mortgage.userLtv}%</span> ·{" "}
                  {t("property.cost.asOf", locale)} <span className="num">{mortgage.regulatoryMaxLtv.asOf}</span>
                </p>
                <Link
                  to="/calculators/mortgage"
                  query={{ price: String(Math.round(purchasePriceMajor)) }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-strong transition-ui hover:gap-1.5"
                >
                  <Calculator className="h-3.5 w-3.5" aria-hidden /> {t("property.cost.openCalculator", locale)}
                </Link>
              </div>
            )}

            {/* Recurring annual costs */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.cost.recurring", locale)}</p>
              <dl className="mt-2.5 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{t("property.cost.serviceCharge", locale)}</dt>
                  <dd className="text-right">
                    {serviceChargeAnnual !== null ? (
                      <>
                        <span className="num font-medium" title={fullValueTooltip(serviceChargeAnnual)}>
                          {formatAEDPrecise(serviceChargeAnnual)}
                        </span>
                        <span className="text-xs text-muted-foreground"> / {t("property.cost.year", locale)}</span>
                        <p className="num mt-0.5 text-[11px] text-muted-foreground">
                          AED {serviceChargePerSqft} / sqft / {t("property.cost.year", locale)} ×{" "}
                          {formatNumber(areaSqft)} sqft
                        </p>
                      </>
                    ) : (
                      <UnavailableValue label={t("property.cost.serviceCharge", locale)} />
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("property.cost.maintenance", locale)}{" "}
                    <span className="num text-[11px]">({formatPctPrecise(YIELD_MODEL_ASSUMPTIONS.maintenancePctOfPrice, 0)})</span>
                  </dt>
                  <dd className="num font-medium" title={maintenanceAnnual !== null ? fullValueTooltip(maintenanceAnnual) : undefined}>
                    {maintenanceAnnual !== null ? (
                      <>
                        {formatAEDPrecise(maintenanceAnnual)}
                        <span className="text-xs font-normal text-muted-foreground"> / {t("property.cost.year", locale)}</span>
                      </>
                    ) : (
                      <UnavailableValue />
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("property.cost.management", locale)}{" "}
                    <span className="num text-[11px]">({formatPctPrecise(YIELD_MODEL_ASSUMPTIONS.managementPct, 0)})</span>
                  </dt>
                  <dd className="num font-medium" title={managementAnnual !== null ? fullValueTooltip(managementAnnual) : undefined}>
                    {managementAnnual !== null ? (
                      <>
                        {formatAEDPrecise(managementAnnual)}
                        <span className="text-xs font-normal text-muted-foreground"> / {t("property.cost.year", locale)}</span>
                      </>
                    ) : (
                      <UnavailableValue label={t("property.cost.managementUnavailable", locale)} />
                    )}
                  </dd>
                </div>
                {annualTotal !== null && annualTotal > 0 && (
                  <div className="flex items-baseline justify-between gap-4 border-t border-border/60 pt-2">
                    <dt className="font-medium">{t("property.cost.recurringSubtotal", locale)}</dt>
                    <dd className="num font-semibold" title={fullValueTooltip(annualTotal)}>
                      {formatAEDPrecise(annualTotal)}
                      <span className="text-xs font-normal text-muted-foreground"> / {t("property.cost.year", locale)}</span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <p className="rounded-lg bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {t("property.cost.disclaimer", locale)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

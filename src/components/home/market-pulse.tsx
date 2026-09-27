"use client";

/**
 * Dubai Market Pulse (V2 §11.2) — compact sourced data strip.
 * Every material value carries a DataStateBadge; the Methodology dialog
 * discloses source/date/methodology per figure with honest UnavailableValue
 * gaps (never a fabricated provenance field).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EvidenceDrawer } from "@/components/common/evidence-drawer";
import { DataStateBadge, UnavailableValue } from "@/components/common";
import { BookOpen } from "lucide-react";
import { t, intlLocale, type Locale } from "@/lib/i18n";
import { formatNumber, formatDate } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { useCountUp } from "@/hooks/use-count-up";
import type { MarketPulse } from "@/components/home/use-home-data";

/** V3 §17 KPI count-up host — exact final value, 900ms once on enter,
 *  reduced-motion/no-JS render the final value immediately. */
function CountUpValue({
  value,
  format,
  title,
}: {
  value: number | null;
  format: (n: number) => string;
  title?: string;
}) {
  const { ref, value: display } = useCountUp(value);
  if (value === null) return <UnavailableValue />;
  return (
    <span ref={ref} title={title ?? format(value)}>
      {format(display ?? 0)}
    </span>
  );
}

function PulseCell({
  label,
  value,
  note,
  state,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  state?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card/70 px-3.5 py-3">
      {/* §18.2 — labels wrap (two lines are fine); never clipped mid-word. */}
      <p className="type-label text-[10px] leading-[1.4] text-muted-foreground">{label}</p>
      <p className="type-data-value mt-1 truncate text-[1.05rem] text-ink" title={typeof value === "string" ? value : undefined}>
        {value}
      </p>
      {state}
      {note && <p className="type-metadata mt-0.5 truncate text-[11px]" title={typeof note === "string" ? note : undefined}>{note}</p>}
    </div>
  );
}

export function MarketPulse({ locale, pulse }: { locale: Locale; pulse: MarketPulse | null }) {
  const l = intlLocale(locale);

  if (!pulse) {
    return (
      <section className="section-contrast section-sm" aria-busy="true">
        <div className="container-page">
          <p className="type-label text-muted-foreground">{t("home.pulse.kicker", locale)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-lg bg-card/50" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const stateBadge = pulse.metricState ? <DataStateBadge state={pulse.metricState} className="mt-1" /> : null;

  return (
    <section className="section-contrast section-sm" aria-labelledby="pulse-heading">
      <div className="container-page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <p className="type-label text-muted-foreground">{t("home.pulse.kicker", locale)}</p>
            <h2 id="pulse-heading" className="type-h3">
              {t("home.pulse.title", locale)}
            </h2>
          </div>
          <EvidenceDrawer
            title={t("home.pulse.methodologyTitle", locale)}
            description="Where each figure comes from — and what is explicitly not provided by the current source."
            surface="home_market_pulse"
            locale={locale}
            evidence={{
              value: pulse.latestDataDate
                ? formatDate(pulse.latestDataDate, l, { year: "numeric", month: "short", day: "numeric" })
                : null,
              state: pulse.metricState,
              source: pulse.sourceName,
              effectiveDate: pulse.latestDataDate,
              methodology: pulse.methodology,
              transformation:
                "Median AED/sqft is computed client-side over the latest page of validated transactions; " +
                "off-plan / ready split is a count over the listing index; community metrics are per-community " +
                "fixtures joined by slug.",
              sampleSize: pulse.transactionSampleSize ?? null,
            }}
            trigger={
              <Button variant="outline" size="sm" className="rounded-full">
                <BookOpen className="h-3.5 w-3.5" aria-hidden /> {t("home.pulse.methodology", locale)}
              </Button>
            }
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <PulseCell
            label={t("home.pulse.dataThrough", locale)}
            value={pulse.latestDataDate ? formatDate(pulse.latestDataDate, l, { year: "numeric", month: "short", day: "numeric" }) : <UnavailableValue />}
            note="per-metric period end"
            state={stateBadge}
          />
          <PulseCell
            label={t("home.pulse.transactions", locale)}
            value={<CountUpValue value={pulse.transactionTotal} format={formatNumber} />}
            note="validated records"
            state={stateBadge}
          />
          <PulseCell
            label={t("home.pulse.medianPsqft", locale)}
            value={
              <CountUpValue
                value={pulse.medianPsqft}
                format={(n) => formatAEDPrecise(n)}
                title="Median of price-per-sqft over the most recent page of validated transactions"
              />
            }
            note={
              pulse.transactionSampleSize
                ? t("home.pulse.latestSample", locale).replace("{n}", formatNumber(pulse.transactionSampleSize))
                : "per-sqft eligible records only"
            }
            state={stateBadge}
          />
          <PulseCell
            label={t("home.pulse.offplanSplit", locale)}
            value={
              pulse.offPlanListings !== null && pulse.readyListings !== null ? (
                <span title={`${formatNumber(pulse.offPlanListings)} off-plan · ${formatNumber(pulse.readyListings)} ready`}>
                  <CountUpValue value={pulse.offPlanListings} format={formatNumber} />{" "}
                  <span className="text-muted-foreground/60">/</span>{" "}
                  <CountUpValue value={pulse.readyListings} format={formatNumber} />
                </span>
              ) : (
                <UnavailableValue />
              )
            }
            note="listed inventory, off-plan / ready"
          />
          <PulseCell
            label={t("home.pulse.rentalActivity", locale)}
            value={<CountUpValue value={pulse.rentalContracts} format={formatNumber} />}
            note={
              pulse.rentalExcluded
                ? `${formatNumber(pulse.rentalExcluded)} excluded as invalid`
                : "validated contracts"
            }
            state={stateBadge}
          />
          <PulseCell
            label={t("home.pulse.communities", locale)}
            value={<CountUpValue value={pulse.communityCount} format={formatNumber} />}
            note="with modeled metrics"
            state={stateBadge}
          />
        </div>
      </div>
    </section>
  );
}

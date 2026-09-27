"use client";

/**
 * Market context (V2 §14.8) — property intelligence block.
 *
 * Combines, with per-figure data-state badges on every value:
 *  - area median / benchmark AED/sqft (market metrics, latest period per key)
 *  - this listing vs the area median (±%, derived)
 *  - rental benchmark (validated rents explorer median, passed in from the page)
 *  - modeled gross + net yield (scenario-engine yieldBreakdown on asking price +
 *    community rent benchmark — always badged MODELED)
 *  - supply / activity context (tracked projects, transaction count metric)
 *
 * Provenance gaps render UnavailableValue — never a fabricated figure.
 */

import * as React from "react";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { EvidenceDrawer } from "@/components/common/evidence-drawer";
import { api } from "@/lib/api-client";
import { yieldBreakdown } from "@/lib/scenario-engine";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import type { MetricState } from "@/lib/data-state";
import { YIELD_MODEL_ASSUMPTIONS, type CommunityDetailLite, type RentBenchmark } from "./detail-shared";
import { TrendingUp, TrendingDown, Building2, Info, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** §28 — compact icon-only evidence affordance for metric cards. Spreads
 *  trigger props (Radix asChild) onto the underlying button. */
function EvidenceIconButton({ ariaLabel, ...props }: { ariaLabel: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground sm:h-7 sm:w-7"
      {...props}
    >
      <BadgeCheck className="h-4 w-4" aria-hidden />
    </button>
  );
}

interface MetricRow {
  metricKey: string;
  periodStart: string;
  valueNumeric: number;
  unit: string;
  sourceName: string | null;
  methodology: string | null;
  isIllustrative: boolean;
  state: MetricState;
}

type LatestMetrics = Partial<Record<string, MetricRow>>;

export function MarketContext({
  community,
  communityDetail,
  askingPriceMajor,
  areaSqft,
  serviceChargePerSqft,
  rentBenchmark,
  locale = "en",
}: {
  community: { name: string; slug: string };
  communityDetail: CommunityDetailLite | null;
  askingPriceMajor: number | null;
  areaSqft: number | null;
  serviceChargePerSqft: number | null;
  rentBenchmark: RentBenchmark | null;
  locale?: Locale;
}) {
  const [metrics, setMetrics] = React.useState<LatestMetrics | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ metrics: MetricRow[] }>(`/api/market/metrics?community=${encodeURIComponent(community.slug)}`)
      .then((res) => {
        if (cancelled) return;
        // Latest period per metricKey (the series carries historical quarters too)
        const latest: LatestMetrics = {};
        for (const m of res?.metrics ?? []) {
          const cur = latest[m.metricKey];
          if (!cur || m.periodStart > cur.periodStart) latest[m.metricKey] = m;
        }
        setMetrics(latest);
      })
      .catch(() => !cancelled && setMetrics({}));
    return () => {
      cancelled = true;
    };
  }, [community.slug]);

  const medianPsqft = metrics?.AVG_PRICE_PER_SQFT ?? null;
  const listingPsqft = askingPriceMajor !== null && areaSqft && areaSqft > 0 ? askingPriceMajor / areaSqft : null;
  const vsMedianPct =
    listingPsqft !== null && medianPsqft && medianPsqft.valueNumeric > 0
      ? ((listingPsqft - medianPsqft.valueNumeric) / medianPsqft.valueNumeric) * 100
      : null;

  /* Modeled yield — scenario engine on asking price + community rent benchmark */
  const yieldModel = React.useMemo(() => {
    if (askingPriceMajor === null || !rentBenchmark?.medianAnnualRent || rentBenchmark.medianAnnualRent <= 0) return null;
    return yieldBreakdown(
      {
        monthlyScheduledRent: rentBenchmark.medianAnnualRent / 12,
        vacancyAllowancePct: YIELD_MODEL_ASSUMPTIONS.vacancyAllowancePct,
        serviceChargeAnnual: serviceChargePerSqft && areaSqft ? serviceChargePerSqft * areaSqft : 0,
        maintenanceAnnual: askingPriceMajor * (YIELD_MODEL_ASSUMPTIONS.maintenancePctOfPrice / 100),
        managementPct: YIELD_MODEL_ASSUMPTIONS.managementPct,
        otherAnnual: 0,
      },
      askingPriceMajor
    );
  }, [askingPriceMajor, rentBenchmark, serviceChargePerSqft, areaSqft]);

  const txCount = metrics?.TRANSACTION_COUNT ?? null;
  const projectsTracked = communityDetail?.projects?.length ?? 0;

  return (
    <section aria-labelledby="market-context-heading">
      <h2 id="market-context-heading" className="font-display text-xl font-semibold">
        {t("property.market.title", locale)}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("property.market.subtitle", locale)} <span className="font-medium text-foreground">{community.name}</span>
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Area median AED/sqft */}
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("property.market.areaMedian", locale)}</p>
            <div className="flex shrink-0 items-center gap-1">
              {medianPsqft ? <DataStateBadge state={medianPsqft.state} /> : null}
              {medianPsqft && (
                <EvidenceDrawer
                  title={t("property.market.areaMedian", locale)}
                  surface="property_market_context"
                  locale={locale}
                  evidence={{
                    value: formatAEDPrecise(medianPsqft.valueNumeric),
                    state: medianPsqft.state,
                    source: medianPsqft.sourceName,
                    effectiveDate: medianPsqft.periodStart,
                    methodology: medianPsqft.methodology,
                    transformation: `Latest period per metric key for ${community.name} — joined by community slug.`,
                  }}
                  trigger={<EvidenceIconButton ariaLabel={t("evidence.open", locale).replace("{title}", t("property.market.areaMedian", locale))} />}
                />
              )}
            </div>
          </div>
          <p className="num mt-2 font-display text-xl font-semibold" title={medianPsqft ? `${medianPsqft.sourceName ?? ""} · ${medianPsqft.periodStart.slice(0, 10)}` : undefined}>
            {medianPsqft ? (
              <>
                {formatAEDPrecise(medianPsqft.valueNumeric)} <span className="text-xs font-normal text-muted-foreground">/ sqft</span>
              </>
            ) : (
              <UnavailableValue />
            )}
          </p>
          {medianPsqft?.methodology && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{medianPsqft.methodology}</p>}
        </div>

        {/* This listing vs area median */}
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("property.market.vsMedian", locale)}</p>
            {vsMedianPct !== null ? <DataStateBadge state={listingPsqft !== null && medianPsqft ? "MODELED" : "UNAVAILABLE"} /> : null}
          </div>
          {vsMedianPct !== null && listingPsqft !== null ? (
            <>
              <p className="num mt-2 font-display text-xl font-semibold">
                {formatAEDPrecise(listingPsqft)} <span className="text-xs font-normal text-muted-foreground">/ sqft</span>
              </p>
              <p
                className={cn(
                  "num mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  vsMedianPct >= 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success-foreground"
                )}
              >
                {vsMedianPct >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                {vsMedianPct >= 0 ? "+" : "−"}
                {formatPctPrecise(Math.abs(vsMedianPct))} {vsMedianPct >= 0 ? t("property.market.above", locale) : t("property.market.below", locale)}
              </p>
            </>
          ) : (
            <p className="mt-2"><UnavailableValue /></p>
          )}
        </div>

        {/* Rental benchmark */}
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("property.market.rentBenchmark", locale)}</p>
            <div className="flex shrink-0 items-center gap-1">
              {rentBenchmark && rentBenchmark.medianAnnualRent ? <DataStateBadge state={rentBenchmark.state} /> : null}
              {rentBenchmark && rentBenchmark.medianAnnualRent ? (
                <EvidenceDrawer
                  title={t("property.market.rentBenchmark", locale)}
                  surface="property_market_context"
                  locale={locale}
                  evidence={{
                    value: formatAEDPrecise(rentBenchmark.medianAnnualRent),
                    state: rentBenchmark.state,
                    source: "Validated rental contract records (rents explorer)",
                    methodology: `Median annual rent across validated contracts in ${rentBenchmark.areaName}.`,
                    sampleSize: rentBenchmark.sampleCount,
                  }}
                  trigger={<EvidenceIconButton ariaLabel={t("evidence.open", locale).replace("{title}", t("property.market.rentBenchmark", locale))} />}
                />
              ) : null}
            </div>
          </div>
          <p className="num mt-2 font-display text-xl font-semibold" title={rentBenchmark?.medianAnnualRent ? fullValueTooltip(rentBenchmark.medianAnnualRent) : undefined}>
            {rentBenchmark?.medianAnnualRent ? (
              <>
                {formatAEDPrecise(rentBenchmark.medianAnnualRent)}
                <span className="text-xs font-normal text-muted-foreground"> / {t("property.market.year", locale)}</span>
              </>
            ) : (
              <UnavailableValue />
            )}
          </p>
          {rentBenchmark && rentBenchmark.medianAnnualRent ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="num">{formatNumber(rentBenchmark.sampleCount)}</span> {t("property.market.observedContracts", locale)} · {rentBenchmark.areaName}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t("property.market.noRentData", locale)}</p>
          )}
        </div>

        {/* Modeled gross / net yield (§14.8 — always labeled) */}
        <div className="rounded-xl border border-brand/25 bg-brand-faint/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("property.market.modeledYield", locale)}</p>
            <div className="flex shrink-0 items-center gap-1">
              <DataStateBadge state="MODELED" />
              {yieldModel ? (
                <EvidenceDrawer
                  title={t("property.market.modeledYield", locale)}
                  surface="property_market_context"
                  locale={locale}
                  evidence={{
                    value: yieldModel ? `${formatPctPrecise(yieldModel.grossYield)} / ${formatPctPrecise(yieldModel.netYield)}` : null,
                    state: "MODELED",
                    source: "Scenario-engine yield model on asking price + community rent benchmark",
                    methodology: `${t("property.market.yieldAssumptions", locale)} — ${t("property.market.yieldMethod", locale)}`,
                    transformation: "Gross = annual rent ÷ asking price; net subtracts vacancy, service charge, maintenance and management allowances.",
                  }}
                  trigger={<EvidenceIconButton ariaLabel={t("evidence.open", locale).replace("{title}", t("property.market.modeledYield", locale))} />}
                />
              ) : null}
            </div>
          </div>
          {yieldModel ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.market.gross", locale)}</p>
                  <p className="num data-value font-semibold text-brand-strong">{formatPctPrecise(yieldModel.grossYield)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.market.net", locale)}</p>
                  <p className="num data-value font-semibold text-brand-strong">{formatPctPrecise(yieldModel.netYield)}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {t("property.market.yieldAssumptions", locale)} — {t("property.market.yieldMethod", locale)}
              </p>
            </>
          ) : (
            <p className="mt-2"><UnavailableValue label={t("property.market.noYield", locale)} /></p>
          )}
        </div>

        {/* Supply / activity context */}
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("property.market.supply", locale)}</p>
            {txCount ? <DataStateBadge state={txCount.state} /> : null}
          </div>
          <div className="mt-2 space-y-1.5 text-sm">
            <p className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="num font-semibold">{formatNumber(projectsTracked)}</span>
              <span className="text-muted-foreground">{t("property.market.projectsTracked", locale)}</span>
            </p>
            <p>
              {txCount ? (
                <>
                  <span className="num font-semibold">{formatNumber(txCount.valueNumeric)}</span>{" "}
                  <span className="text-muted-foreground">{t("property.market.transactionsPeriod", locale)}</span>
                </>
              ) : (
                <UnavailableValue label={t("property.market.transactionsLabel", locale)} />
              )}
            </p>
          </div>
        </div>

        {/* Methodology footnote card */}
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("property.market.methodNote", locale)}
          </p>
        </div>
      </div>
    </section>
  );
}

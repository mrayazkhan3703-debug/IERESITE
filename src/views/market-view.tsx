"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState, DataStateNotice } from "@/components/common";
import { MarketHeatmapTable } from "@/components/charts/market-heatmap-table";
import { MarketTabs, activeMarketTab } from "@/components/market/market-tabs";
import { KpiRow } from "@/components/market/kpi-row";
import { CommunityComparison } from "@/components/market/community-comparison";
import { ReportCards } from "@/components/market/report-cards";
import { api } from "@/lib/api-client";
import { formatAEDPrecise } from "@/lib/format-precise";
import { TrendingUp, FileText, ArrowRight } from "lucide-react";
import type { LatestMetric } from "@/components/market/market-types";

/**
 * Market Intelligence overview (U10 §19.1/§19.2/§19.6/§19.7) — mode tablist +
 * KPI layer + community comparison + reports. The tab is URL-driven
 * (/market, /market?tab=communities, /market?tab=reports); Transactions, Rents
 * and Map are dedicated routes linked from the shared tablist.
 */
export default function MarketView() {
  const loc = useRoute();
  const tab = activeMarketTab(loc.path, loc.query);
  const [metrics, setMetrics] = React.useState<LatestMetric[] | null>(null);

  usePageMeta({
    title: "Dubai Market Intelligence — Data, Reports & Trends",
    description:
      "Evidence-led Dubai property market intelligence: KPI overview, transaction and rental explorers, community comparison with sources and methodology, and downloadable reports.",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Dubai Market Intelligence",
    },
  });

  React.useEffect(() => {
    api.get<{ metrics: LatestMetric[] }>("/api/market/metrics?latest=1").then((r) => setMetrics(r.metrics)).catch(() => setMetrics([]));
  }, []);

  const hero = (
    <section className="border-b border-border/70 bg-sand/50 py-10 sm:py-14">
      <div className="container-page">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Market Intelligence" }]} />
        <p className="kicker mt-4">Market intelligence</p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          The Dubai market, with receipts
        </h1>
        <p className="mt-4 max-w-2xl text-balance text-muted-foreground">
          Community-level prices, rents and yields — every figure with source, retrieval date and methodology. Where
          data is illustrative, we label it; production figures come from the DLD open-data import.
        </p>
        {/* Environment disclosure — demo/staging datasets only (V2 §5.1) */}
        <DataStateNotice scope="these market intelligence pages" className="mt-6 max-w-3xl" />
      </div>
    </section>
  );

  return (
    <div className="pb-16">
      {hero}
      <MarketTabs />

      {tab === "overview" && (
        <>
          {/* KPI layer (§19.2) */}
          <section className="container-page py-10" aria-labelledby="kpi-heading">
            <SectionHeading id="kpi-heading" kicker="Headline numbers" title="The market at a glance" />
            <KpiRow />
          </section>

          {/* Explorers */}
          <section className="container-page pb-10" aria-labelledby="explorers-heading">
            <SectionHeading id="explorers-heading" kicker="Data explorers" title="Explore the numbers" />
            <div className="grid gap-5 sm:grid-cols-2">
              {[
                {
                  to: "/market/transactions",
                  title: "Transactions Explorer",
                  desc: "Sale transactions by area, type and period — medians, distributions and volumes with provenance.",
                  icon: TrendingUp,
                },
                {
                  to: "/market/rents",
                  title: "Rental Trends",
                  desc: "Contract rents by area and bedrooms — distributions, compare-areas and trends, the input to every yield calculation.",
                  icon: FileText,
                },
              ].map((x) => (
                <Link
                  key={x.to}
                  to={x.to}
                  className="group flex flex-col rounded-xl border border-border/70 bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-brand-soft p-2.5 text-brand-strong transition-ui group-hover:bg-brand group-hover:text-white" aria-hidden>
                      <x.icon className="h-5 w-5" />
                    </span>
                    <h2 className="font-display text-xl font-semibold group-hover:text-brand-strong">{x.title}</h2>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{x.desc}</p>
                  <span className="mt-4 inline-flex w-fit items-center gap-1.5 self-end rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-ui group-hover:border-brand/50 group-hover:text-brand-strong">
                    Open <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* Community comparison (§19.6) — synchronized 2–4 selection */}
          <section className="container-page pb-10" aria-labelledby="comparison-heading">
            <SectionHeading
              id="comparison-heading"
              kicker="Side by side"
              title="Community comparison"
              description="Pick 2–4 communities — AED/sqft, median transaction, rent, yield, volume, off-plan/ready split and supply stay synchronized to one selection."
              action={
                <Link
                  to="/market"
                  query={{ tab: "communities" }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-ui hover:border-brand/50 hover:text-brand-strong"
                >
                  Open the full comparison tab <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              }
            />
            <CommunityComparison />
          </section>

          {/* Metrics heatmap */}
          {metrics !== null && metrics.length > 0 && (
            <section className="container-page pb-10" aria-labelledby="heatmap-heading">
              <SectionHeading
                id="heatmap-heading"
                kicker="One table, every tracked metric"
                title="Community metrics heatmap"
                description="Five tracked metrics side by side — prices, rents, yield and activity — shaded relative to each column so outliers stand out immediately."
              />
              <div className="mt-5">
                <MarketHeatmapTable metrics={metrics} />
              </div>
            </section>
          )}

          {/* Reports (§19.7) — preview cards */}
          <section className="container-page pb-12" aria-labelledby="reports-heading">
            <SectionHeading
              id="reports-heading"
              kicker="Research"
              title="Reports & briefings"
              action={
                <Link
                  to="/market"
                  query={{ tab: "reports" }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-ui hover:border-brand/50 hover:text-brand-strong"
                >
                  All reports <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              }
            />
            <ReportCards />
          </section>
        </>
      )}

      {tab === "communities" && (
        <section className="container-page py-10" aria-labelledby="communities-heading">
          <SectionHeading
            id="communities-heading"
            kicker="Synchronized charts"
            title="Community comparison lab"
            description="Select 2–4 communities below — every chart in the group updates together: AED/sqft, median transaction, rent, gross yield, transaction volume, off-plan/ready split and supply pipeline. The selection is saved in the URL, so comparisons are shareable."
          />
          <CommunityComparison />
          {metrics === null ? (
            <div className="mt-8">
              <LoadingState rows={2} />
            </div>
          ) : (
            <div className="mt-10">
              <SectionHeading kicker="Reference table" title="All tracked metrics" description="Relative-intensity heatmap across every tracked community and metric." />
              <MarketHeatmapTable metrics={metrics} />
            </div>
          )}
        </section>
      )}

      {tab === "reports" && (
        <section className="container-page py-10" aria-labelledby="reports-tab-heading">
          <SectionHeading
            id="reports-tab-heading"
            kicker="Research"
            title="Reports & briefings"
            description="Every report card carries its author, publication date, covered period, source retrieval date, methodology summary and related communities — preview before the gated download."
          />
          <ReportCards />
          <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
            Development environment: report figures are illustrative fixtures pending the DLD open-data import (see
            provenance labels on every figure). Download counts reset with the fixture dataset — a sample headline
            value: median community AED/sqft {"≈"} {formatAEDPrecise(1750)}.
          </p>
        </section>
      )}
    </div>
  );
}

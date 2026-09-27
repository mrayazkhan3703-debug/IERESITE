"use client";

/**
 * KPI layer (U10 §19.2) — eight sourced headline cards on the market overview.
 * Values are assembled client-side from the existing APIs (transactions agg,
 * rents agg, communities registry, listings search) — the same validated
 * numbers the explorers show, so the overview can never disagree with them.
 * Every card carries a DataStateBadge and the latest data date.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { DataStateBadge, LoadingState, UnavailableValue } from "@/components/common";
import { EvidenceDrawer, type EvidenceRecord } from "@/components/common/evidence-drawer";
import type { MetricState } from "@/lib/data-state";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatNumber, formatDate } from "@/lib/money";
import { t, localeOf, type Locale } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import type { CommunityCardLite, MarketAgg, MarketRow } from "./market-types";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiData {
  txAgg: MarketAgg | null;
  txState: MetricState | null;
  txDateMax: string | null;
  rentAgg: MarketAgg | null;
  rentState: MetricState | null;
  rentDateMax: string | null;
  communities: CommunityCardLite[] | null;
  saleTotal: number | null;
  offPlanTotal: number | null;
}

interface TxLite {
  agg?: MarketAgg;
  rows?: MarketRow[];
}

interface ListingsLite {
  total: number;
}

function useKpiData(): KpiData {
  const [state, setState] = React.useState<KpiData>({
    txAgg: null,
    txState: null,
    txDateMax: null,
    rentAgg: null,
    rentState: null,
    rentDateMax: null,
    communities: null,
    saleTotal: null,
    offPlanTotal: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    const apply = (patch: Partial<KpiData>) => {
      if (!cancelled) setState((s) => ({ ...s, ...patch }));
    };

    api
      .get<TxLite>("/api/market/transactions?pageSize=1")
      .then((r) => apply({ txAgg: r.agg ?? null, txState: r.rows?.[0]?.state ?? null, txDateMax: r.agg?.dateMax ?? null }))
      .catch(() => apply({ txAgg: undefined, txDateMax: null }));
    api
      .get<TxLite>("/api/market/rents?pageSize=1")
      .then((r) => apply({ rentAgg: r.agg ?? null, rentState: r.rows?.[0]?.state ?? null, rentDateMax: r.agg?.dateMax ?? null }))
      .catch(() => apply({ rentAgg: undefined }));
    api
      .get<{ communities: CommunityCardLite[] }>("/api/communities")
      .then((r) => apply({ communities: r.communities }))
      .catch(() => apply({ communities: [] }));
    api
      .get<ListingsLite>("/api/properties?limit=1&type=sale")
      .then((r) => apply({ saleTotal: r.total }))
      .catch(() => apply({ saleTotal: null }));
    api
      .get<ListingsLite>("/api/properties?limit=1&type=sale&offPlan=1")
      .then((r) => apply({ offPlanTotal: r.total }))
      .catch(() => apply({ offPlanTotal: null }));

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function numOrNull(minor: string | null | undefined): number | null {
  if (minor === null || minor === undefined) return null;
  const n = Number(minor);
  return Number.isFinite(n) ? n / 100 : null;
}

function KpiCard({
  label,
  value,
  sub,
  state,
  asOf,
  locale,
  sr,
  evidence,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  state: MetricState | null;
  asOf: string | null;
  locale: Locale;
  sr?: string;
  /** V3-G §28 — standard evidence affordance on every KPI. */
  evidence?: EvidenceRecord;
}) {
  const t_ = (key: string) => t(key, locale);
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md">
      {/* §40: label + state badge wrap on 2-col phones instead of forcing overflow. */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {state && <DataStateBadge state={state} />}
      </div>
      <p className="num mt-2 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{value}</p>
      {sub && <p className="num mt-1 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <p className="text-[11px] text-muted-foreground/80">
          {asOf ? t_("market.kpi.asOf").replace("{date}", formatDate(asOf)) : "—"}
        </p>
        {evidence && (
          <EvidenceDrawer
            title={label}
            surface="market_kpi"
            locale={locale}
            evidence={evidence}
            triggerClassName="h-auto min-h-8 px-1.5 py-1 sm:h-auto"
          />
        )}
      </div>
      {sr && <span className="sr-only">{sr}</span>}
    </div>
  );
}

export function KpiRow() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);
  const d = useKpiData();

  if (d.txAgg === null || d.rentAgg === null || d.communities === null) {
    return (
      <div role="status" aria-label={t_("market.kpi.loading")}>
        <LoadingState rows={2} />
      </div>
    );
  }

  const tx = d.txAgg ?? undefined;
  const rent = d.rentAgg ?? undefined;
  const txCount = tx?.count ?? 0;
  const volumeAed = tx?.totalVolumeMinor ? numOrNull(tx.totalVolumeMinor) : null;
  const medianSale = numOrNull(tx?.medianAmountMinor ?? null);
  const medianPpsft = numOrNull(tx?.medianPerSqftMinor ?? null);
  const medianRentAed = numOrNull(rent?.medianRentMinor ?? null);
  const grossYield =
    medianRentAed !== null && medianSale !== null && medianSale > 0 ? (medianRentAed / medianSale) * 100 : null;
  const months = tx && tx.dateMin && tx.dateMax ? Math.max(1, Math.round((Date.parse(tx.dateMax) - Date.parse(tx.dateMin)) / (30.44 * 86400_000))) : null;
  const txPerMonth = months ? txCount / months : null;
  const offPlanShare = d.saleTotal && d.offPlanTotal !== null && d.saleTotal > 0 ? (d.offPlanTotal / d.saleTotal) * 100 : null;
  const communityCount = d.communities.length;
  const listingTotal = d.communities.reduce((s, c) => s + (c.listingCount ?? 0), 0);
  const latestDate = [d.txDateMax, d.rentDateMax].filter(Boolean).sort().pop() ?? null;

  const cards: React.ReactNode[] = [
    <KpiCard
      key="volume"
      label={t_("market.kpi.txVolume")}
      value={volumeAed !== null ? formatAEDPrecise(volumeAed) : <UnavailableValue />}
      sub={t_("market.kpi.txVolumeSub").replace("{n}", formatNumber(txCount))}
      state={d.txState}
      asOf={d.txDateMax}
      locale={locale}
      evidence={{
        value: volumeAed !== null ? formatAEDPrecise(volumeAed) : null,
        state: d.txState,
        source: "Validated transaction records (transactions explorer aggregation)",
        effectiveDate: d.txDateMax,
        sampleSize: txCount,
        methodology: "Sum of transaction amounts over the validated records loaded by the explorer — the same records the transaction explorer lists.",
        caveats: tx?.excludedRecords ? `${formatNumber(tx.excludedRecords)} records were excluded by validation before aggregation.` : null,
      }}
      sr={`Total transaction volume ${volumeAed !== null ? formatAEDPrecise(volumeAed) : "not provided"} across ${formatNumber(txCount)} transactions.`}
    />,
    <KpiCard
      key="count"
      label={t_("market.kpi.txCount")}
      value={formatNumber(txCount)}
      sub={txPerMonth !== null ? t_("market.kpi.txCountSub").replace("{n}", formatNumber(Math.round(txPerMonth))) : undefined}
      state={d.txState}
      asOf={d.txDateMax}
      locale={locale}
      evidence={{
        value: formatNumber(txCount),
        state: d.txState,
        source: "Validated transaction records (transactions explorer aggregation)",
        effectiveDate: d.txDateMax,
        sampleSize: txCount,
        methodology: "Count of validated transaction records in the loaded period; per-month figure divides by the covered months.",
      }}
      sr={`${formatNumber(txCount)} recorded transactions in the dataset.`}
    />,
    <KpiCard
      key="median-sale"
      label={t_("market.kpi.medianSale")}
      value={medianSale !== null ? formatAEDPrecise(medianSale) : <UnavailableValue />}
      state={d.txState}
      asOf={d.txDateMax}
      locale={locale}
      evidence={{
        value: medianSale !== null ? formatAEDPrecise(medianSale) : null,
        state: d.txState,
        source: "Validated transaction records (transactions explorer aggregation)",
        effectiveDate: d.txDateMax,
        sampleSize: txCount,
        methodology: "Median of transaction amounts over the validated records — robust to outlier transactions.",
      }}
      sr={`Median sale price ${medianSale !== null ? formatAEDPrecise(medianSale) : "not provided"}.`}
    />,
    <KpiCard
      key="ppsft"
      label={t_("market.kpi.ppsft")}
      value={medianPpsft !== null ? `AED ${formatNumber(Math.round(medianPpsft))}` : <UnavailableValue />}
      sub={tx?.perSqftCount ? t_("market.kpi.ppsftSub").replace("{n}", formatNumber(tx.perSqftCount)) : undefined}
      state={d.txState}
      asOf={d.txDateMax}
      locale={locale}
      evidence={{
        value: medianPpsft !== null ? `AED ${formatNumber(Math.round(medianPpsft))}` : null,
        state: d.txState,
        source: "Validated transaction records (transactions explorer aggregation)",
        effectiveDate: d.txDateMax,
        sampleSize: tx?.perSqftCount ?? null,
        methodology: "Median of amount ÷ area (sqft) over records with a usable area; records missing or with non-positive area are excluded from this metric only.",
      }}
      sr={`Median price per square foot ${medianPpsft !== null ? `AED ${formatNumber(Math.round(medianPpsft))}` : "not provided"} over ${formatNumber(tx?.perSqftCount ?? 0)} records with usable area.`}
    />,
    <KpiCard
      key="rent"
      label={t_("market.kpi.rent")}
      value={medianRentAed !== null ? formatAEDPrecise(medianRentAed) : <UnavailableValue />}
      sub={rent ? `${formatNumber(rent.count)} contracts` : undefined}
      state={d.rentState}
      asOf={d.rentDateMax}
      locale={locale}
      evidence={{
        value: medianRentAed !== null ? formatAEDPrecise(medianRentAed) : null,
        state: d.rentState,
        source: "Validated rental contract records (rents explorer aggregation)",
        effectiveDate: d.rentDateMax,
        sampleSize: rent?.count ?? null,
        methodology: "Median annual rent across validated rental contracts; non-positive rents are excluded by validation.",
      }}
      sr={`Median annual rent ${medianRentAed !== null ? formatAEDPrecise(medianRentAed) : "not provided"} over ${formatNumber(rent?.count ?? 0)} validated contracts.`}
    />,
    <KpiCard
      key="yield"
      label={t_("market.kpi.grossYield")}
      value={grossYield !== null ? formatPctPrecise(grossYield) : <UnavailableValue />}
      sub={t_("market.kpi.grossYieldSub")}
      state={grossYield !== null ? ("MODELED" as MetricState) : ("UNAVAILABLE" as MetricState)}
      asOf={latestDate}
      locale={locale}
      evidence={{
        value: grossYield !== null ? formatPctPrecise(grossYield) : null,
        state: grossYield !== null ? ("MODELED" as MetricState) : ("UNAVAILABLE" as MetricState),
        source: "Modeled from the median rent and median sale aggregations",
        effectiveDate: latestDate,
        sampleSize: null,
        methodology: "Median annual rent ÷ median sale price × 100 — a modeled cross-dataset ratio, not an observed figure. Net yield, service charges and financing are not included.",
      }}
      sr={`Modeled gross yield ${grossYield !== null ? formatPctPrecise(grossYield) : "not provided"} — median rent over median sale price, a modeled cross-dataset ratio, not an observed figure.`}
    />,
    <KpiCard
      key="offplan"
      label={t_("market.kpi.offplanShare")}
      value={offPlanShare !== null ? formatPctPrecise(offPlanShare) : <UnavailableValue />}
      sub={t_("market.kpi.offplanShareSub")}
      state={offPlanShare !== null ? ("ILLUSTRATIVE" as MetricState) : ("UNAVAILABLE" as MetricState)}
      asOf={latestDate}
      locale={locale}
      evidence={{
        value: offPlanShare !== null ? formatPctPrecise(offPlanShare) : null,
        state: offPlanShare !== null ? ("ILLUSTRATIVE" as MetricState) : ("UNAVAILABLE" as MetricState),
        source: "Listing index (active sale listings)",
        effectiveDate: latestDate,
        sampleSize: d.saleTotal,
        methodology: "Off-plan listings ÷ all active sale listings on the platform — an inventory share of listings, not of registered transactions.",
      }}
      sr={`Off-plan share ${offPlanShare !== null ? formatPctPrecise(offPlanShare) : "not provided"} of ${formatNumber(d.saleTotal ?? 0)} active sale listings.`}
    />,
    <KpiCard
      key="inventory"
      label={t_("market.kpi.inventory")}
      value={formatNumber(communityCount)}
      sub={t_("market.kpi.inventorySub").replace("{n}", formatNumber(communityCount)).replace("{n2}", formatNumber(listingTotal))}
      state={("ILLUSTRATIVE" as MetricState)}
      asOf={latestDate}
      locale={locale}
      evidence={{
        value: formatNumber(communityCount),
        state: "ILLUSTRATIVE" as MetricState,
        source: "Community registry (/api/communities)",
        effectiveDate: latestDate,
        sampleSize: communityCount,
        methodology: "Count of monitored communities and the sum of their active listing counts — platform inventory, not a market-wide figure.",
      }}
      sr={`${formatNumber(communityCount)} monitored communities carrying ${formatNumber(listingTotal)} listings.`}
    />,
  ];

  return (
    <div>
      {/* V3-F §57 — two columns on phones (with the value scale stepped down
          one notch below sm so precise AED figures never wrap awkwardly). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, i) => (
          <div key={i} className={cn("min-w-0")}>{card}</div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {t_("market.kpi.sub")}{" "}
        <Link to="/market/transactions" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
          Drill into the explorers <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </p>
    </div>
  );
}

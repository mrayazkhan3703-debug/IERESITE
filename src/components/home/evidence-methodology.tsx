"use client";

/**
 * Evidence Methodology (V2 §11.10) — the evidence-first narrative, interactive.
 * Four clickable figures open an evidence dialog: source, publisher, effective
 * date, retrieval date, methodology, transformation, freshness, verification.
 * Missing provenance fields render UnavailableValue — honesty over invention.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DataStateBadge, UnavailableValue } from "@/components/common";
import { TrendingUp, Calculator } from "lucide-react";
import { t, intlLocale, type Locale } from "@/lib/i18n";
import { formatNumber, formatDate } from "@/lib/money";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import type { CommunityMetricSet, MarketPulse } from "@/components/home/use-home-data";

interface EvidenceFigure {
  key: string;
  label: string;
  value: string;
  /** Aggregation the homepage applies to the raw metric — declared honestly. */
  transformation: string;
  /** Underlying metric rows backing the figure (may be several). */
  from: CommunityMetricSet[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export function EvidenceMethodology({
  locale,
  communityMetrics,
  pulse,
}: {
  locale: Locale;
  communityMetrics: Record<string, CommunityMetricSet> | null;
  pulse: MarketPulse | null;
}) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const l = intlLocale(locale);
  const sets = Object.values(communityMetrics ?? {});
  const n = sets.length;

  const figures: EvidenceFigure[] = React.useMemo(() => {
    const list: EvidenceFigure[] = [];
    const medianPrices = sets.map((s) => s.medianTransPrice).filter((v): v is number => v != null);
    const psqfts = sets.map((s) => s.avgPricePerSqft).filter((v): v is number => v != null);
    const yields = sets.map((s) => s.yieldPct).filter((v): v is number => v != null);
    if (medianPrices.length) {
      list.push({
        key: "median-price",
        label: t("home.evidence.medianPrice", locale),
        value: formatAEDPrecise(median(medianPrices) ?? 0),
        transformation: t("home.evidence.acrossCommunities", locale).replace("{n}", formatNumber(medianPrices.length)),
        from: sets.filter((s) => s.medianTransPrice != null),
      });
    }
    if (psqfts.length) {
      list.push({
        key: "psqft",
        label: t("home.evidence.psqft", locale),
        value: `${formatNumber(Math.round(median(psqfts) ?? 0))} AED/sqft`,
        transformation: t("home.evidence.acrossCommunities", locale).replace("{n}", formatNumber(psqfts.length)),
        from: sets.filter((s) => s.avgPricePerSqft != null),
      });
    }
    if (pulse?.transactionTotal != null) {
      list.push({
        key: "volume",
        label: t("home.evidence.volume", locale),
        value: formatNumber(pulse.transactionTotal),
        transformation: "Count of validated transaction records in the tracked window (hard-invalid rows excluded).",
        from: sets.slice(0, 1),
      });
    }
    if (yields.length) {
      list.push({
        key: "yield-range",
        label: t("home.evidence.yieldRange", locale),
        value: `${formatPctPrecise(Math.min(...yields), 1)} – ${formatPctPrecise(Math.max(...yields), 1)}`,
        transformation: `Min–max across ${formatNumber(yields.length)} monitored communities`,
        from: sets.filter((s) => s.yieldPct != null),
      });
    }
    return list;
  }, [sets, pulse, locale]);

  const openFigure = figures.find((f) => f.key === openKey) ?? null;
  const openMetric = openFigure?.from[0];

  return (
    <section className="section-ink section" aria-labelledby="evidence-heading">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="kicker mb-2 text-white/50">{t("home.evidence.kicker", locale)}</p>
            <h2 id="evidence-heading" className="type-h2 on-ink">
              {t("home.evidence.title", locale)}
            </h2>
            <p className="mt-4 max-w-lg text-balance text-muted-foreground">{t("home.evidence.subtitle", locale)}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full">
                <Link to="/market">
                  <TrendingUp className="h-4 w-4" aria-hidden /> Market intelligence
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/invest">
                  <Calculator className="h-4 w-4" aria-hidden /> Investor tools
                </Link>
              </Button>
            </div>
          </div>

          {/* Clickable evidence figures */}
          <div className="grid gap-3 sm:grid-cols-2">
            {figures.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setOpenKey(f.key)}
                className="group rounded-lg border border-white/15 bg-white/[0.07] p-4 text-start transition-ui hover:bg-white/[0.11] focus-visible:bg-white/[0.11]"
                aria-haspopup="dialog"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-white/60">{f.label}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-brand group-hover:underline">
                    Evidence →
                  </span>
                </span>
                <span className="data-value mt-2 block text-2xl font-bold tracking-tight text-white">{f.value}</span>
                <span className="mt-1 block text-[11px] text-white/55">{f.transformation}</span>
              </button>
            ))}
            {figures.length === 0 && (
              <p className="text-sm text-muted-foreground">Market metrics are loading — evidence records appear here.</p>
            )}
          </div>
        </div>
      </div>

      {/* Evidence drawer */}
      <Dialog open={openKey !== null} onOpenChange={(v) => !v && setOpenKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{openFigure ? `${openFigure.label} — evidence record` : "Evidence record"}</DialogTitle>
            <DialogDescription>
              {openFigure ? `${openFigure.value} · ${openFigure.transformation}` : ""}
            </DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border/60 text-sm">
            <Row label={t("home.evidence.source", locale)}>{openMetric?.sourceName ?? <UnavailableValue />}</Row>
            <Row label={t("home.evidence.publisher", locale)}>
              <UnavailableValue />
            </Row>
            <Row label={t("home.evidence.effectiveDate", locale)}>
              {openMetric?.periodEnd ? (
                formatDate(openMetric.periodEnd, l, { year: "numeric", month: "short", day: "numeric" })
              ) : (
                <UnavailableValue />
              )}
            </Row>
            <Row label={t("home.evidence.retrievalDate", locale)}>
              <UnavailableValue />
            </Row>
            <div className="py-1">
              <dt className="font-medium text-muted-foreground">{t("home.evidence.methodology", locale)}</dt>
              <dd className="mt-1 leading-relaxed text-foreground/90">
                {openMetric?.methodology ?? <UnavailableValue />}
              </dd>
            </div>
            <div className="py-1">
              <dt className="font-medium text-muted-foreground">{t("home.evidence.transformation", locale)}</dt>
              <dd className="mt-1 leading-relaxed text-foreground/90">
                {openFigure?.transformation ?? <UnavailableValue />}
              </dd>
            </div>
            <Row label={t("home.evidence.freshness", locale)}>
              {openMetric?.state ? <DataStateBadge state={openMetric.state} /> : <UnavailableValue />}
            </Row>
            <Row label={t("home.evidence.verification", locale)}>
              {openMetric?.state ? <DataStateBadge state={openMetric.state} /> : <UnavailableValue />}
            </Row>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Fields the current source does not provide are shown as “not provided” — they are never inferred.
            {pulse?.dataState ? ` Environment data state: ${pulse.dataState}.` : ""}
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}

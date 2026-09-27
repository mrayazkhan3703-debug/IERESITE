"use client";

/**
 * Community comparison (U10 §19.6) — 2–4 community multi-select chips driving a
 * SYNCHRONIZED chart group: AED/sqft, median transaction, rent, yield, volume,
 * off-plan/ready split and supply. Every chart receives the identical
 * selection set. Selection persists in the URL (?c=slug,slug) so comparison
 * states are shareable. Metrics come from /api/market/metrics?latest=1 with
 * per-metric data-state; supply comes from each community's detail projection.
 */

import * as React from "react";
import { Link, useRoute, navigate } from "@/lib/router";
import { api } from "@/lib/api-client";
import { LoadingState, DataStateBadge } from "@/components/common";
import { CommunityMetricChart, CommunitySplitChart } from "./community-metric-chart";
import { t, localeOf } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import type { CommunityCardLite, LatestMetric } from "./market-types";
import type { SourceInfo } from "./market-types";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommunityDetailLite {
  slug: string;
  name: string;
  supplyPipeline: { totalProjects: number; underConstruction: number; offPlan: number; ready: number };
}

const METRIC_KEYS = [
  "AVG_PRICE_PER_SQFT",
  "MEDIAN_TRANS_PRICE",
  "AVG_RENT_1BR",
  "YIELD_PCT",
  "TRANSACTION_COUNT",
] as const;

export function CommunityComparison({ preselected }: { preselected?: string[] }) {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);

  const [communities, setCommunities] = React.useState<CommunityCardLite[] | null>(null);
  const [metrics, setMetrics] = React.useState<LatestMetric[] | null>(null);
  const [selected, setSelected] = React.useState<string[]>(preselected ?? []);
  const [details, setDetails] = React.useState<Record<string, CommunityDetailLite>>({});
  const [loadedInitial, setLoadedInitial] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ communities: CommunityCardLite[] }>("/api/communities").catch(() => ({ communities: [] as CommunityCardLite[] })),
      api.get<{ metrics: LatestMetric[] }>("/api/market/metrics?latest=1").catch(() => ({ metrics: [] as LatestMetric[] })),
    ]).then(([c, m]) => {
      if (cancelled) return;
      setCommunities(c.communities);
      setMetrics(m.metrics);
      setLoadedInitial(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Default selection: first two communities with a complete metric set (or query ?c=).
  React.useEffect(() => {
    if (!loadedInitial || (preselected && preselected.length > 0) || selected.length > 0) return;
    if (!communities || !metrics) return;
    const withMetrics = communities.filter((c) =>
      METRIC_KEYS.every((k) => metrics.some((m) => m.community.slug === c.slug && m.metricKey === k))
    );
    const seed = (loc.query.c ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (seed.length >= 2) {
      setSelected(seed.slice(0, 4));
    } else if (withMetrics.length >= 2) {
      setSelected(withMetrics.slice(0, 2).map((c) => c.slug));
    }
  }, [loadedInitial, communities, metrics]);

  // Fetch details (supply pipeline) for the selected communities.
  React.useEffect(() => {
    let cancelled = false;
    const missing = selected.filter((slug) => !details[slug]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((slug) =>
        api
          .get<CommunityDetailLite>(`/api/communities/${slug}`)
          .then((d) => ({ slug, d }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r) next[r.slug] = r.d;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selected, details]);

  // Persist selection to the URL (?c=) — replace, not push.
  React.useEffect(() => {
    if (!loadedInitial || selected.length === 0) return;
    const current = (loc.query.c ?? "").split(",").filter(Boolean).join(",");
    const next = selected.join(",");
    if (current !== next) {
      navigate("/market", { ...(loc.query.tab ? { tab: loc.query.tab } : {}), ...(next ? { c: next } : {}) }, { replace: true });
    }
  }, [selected]);

  if (!loadedInitial || communities === null || metrics === null) {
    return <LoadingState rows={3} />;
  }

  const bySlugMetric = new Map<string, LatestMetric>();
  for (const m of metrics) {
    if (METRIC_KEYS.includes(m.metricKey as (typeof METRIC_KEYS)[number])) {
      bySlugMetric.set(`${m.community.slug}:${m.metricKey}`, m);
    }
  }

  const toggle = (slug: string) => {
    setSelected((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 4) return prev;
      return [...prev, slug];
    });
  };

  const metric = (slug: string, key: (typeof METRIC_KEYS)[number]): LatestMetric | undefined => bySlugMetric.get(`${slug}:${key}`);
  const metricState = (key: (typeof METRIC_KEYS)[number]): "ILLUSTRATIVE" | undefined => {
    for (const slug of selected) {
      const m = metric(slug, key);
      if (m) return "ILLUSTRATIVE";
    }
    return undefined;
  };

  const sourceFor = (title: string): SourceInfo => ({
    title,
    source: metrics[0]?.sourceName ?? "Illustrative model (dev)",
    state: metrics[0]?.state,
    coverage: metrics[0] ? { from: metrics[0].periodStart, to: metrics[0].periodEnd, records: metrics.length } : undefined,
    methodology: metrics[0]?.methodology ?? null,
  });

  const selectedCommunities = selected
    .map((slug) => communities.find((c) => c.slug === slug))
    .filter((c): c is CommunityCardLite => !!c);

  const chartData = (key: (typeof METRIC_KEYS)[number]) =>
    selected.map((slug) => {
      const m = metric(slug, key);
      const name = communities.find((c) => c.slug === slug)?.name ?? slug;
      return { name, value: m ? m.valueNumeric : null };
    });

  return (
    <div>
      {/* Selection chips */}
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="kicker">{t_("market.compare.pick")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t_("market.compare.selected").replace("{n}", String(selected.length))} · {t_("market.compare.pickHint")}
            </p>
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-ui hover:border-destructive/40 hover:text-destructive"
              onClick={() => setSelected([])}
            >
              {t_("market.compare.clear")}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t_("market.compare.title")}>
          {communities.map((c) => {
            const isSelected = selected.includes(c.slug);
            const disabled = !isSelected && selected.length >= 4;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                aria-disabled={disabled}
                onClick={() => toggle(c.slug)}
                title={disabled ? t_("market.compare.max") : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                  isSelected
                    ? "border-brand bg-brand-soft text-brand-strong shadow-sm"
                    : disabled
                      ? "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground/50"
                      : "border-border bg-card text-foreground/80 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md"
                )}
              >
                {c.name}
                <span className="num text-[10px] text-muted-foreground">{formatNumber(c.listingCount)}</span>
                {isSelected && <X className="h-3 w-3" aria-hidden />}
              </button>
            );
          })}
        </div>
        {selected.length >= 2 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{t_("market.compare.sub")}</span>
            {metricState("AVG_PRICE_PER_SQFT") && (
              <DataStateBadge state={metrics.find((m) => m.metricKey === "AVG_PRICE_PER_SQFT")?.state ?? "ILLUSTRATIVE"} />
            )}
          </div>
        )}
      </div>

      {/* Synchronized chart group */}
      {selected.length < 2 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border bg-sand/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t_("market.compare.empty")}
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <CommunityMetricChart
              title={t_("market.compare.ppsft")}
              data={chartData("AVG_PRICE_PER_SQFT")}
              format="aed"
              source={sourceFor(t_("market.compare.ppsft"))}
              note="Latest avg price per sqft on record per community."
            />
            <CommunityMetricChart
              title={t_("market.compare.medianTx")}
              data={chartData("MEDIAN_TRANS_PRICE")}
              format="aed"
              source={sourceFor(t_("market.compare.medianTx"))}
              note="Latest median transaction value per community."
            />
            <CommunityMetricChart
              title={t_("market.compare.rent")}
              data={chartData("AVG_RENT_1BR")}
              format="aed"
              source={sourceFor(t_("market.compare.rent"))}
              note="Latest average 1-bedroom annual rent per community."
            />
            <CommunityMetricChart
              title={t_("market.compare.yield")}
              data={chartData("YIELD_PCT")}
              format="percent"
              source={sourceFor(t_("market.compare.yield"))}
              note="Modeled gross yield — median rent over median price, labeled as modeled."
            />
            <CommunityMetricChart
              title={t_("market.compare.volume")}
              data={chartData("TRANSACTION_COUNT")}
              format="count"
              source={sourceFor(t_("market.compare.volume"))}
              note="Recorded transactions in the tracked period."
            />
            <CommunitySplitChart
              title={t_("market.compare.supplySplit")}
              data={selected.map((slug) => {
                const d = details[slug];
                const name = communities.find((c) => c.slug === slug)?.name ?? slug;
                return {
                  name,
                  offPlan: d ? d.supplyPipeline.offPlan + d.supplyPipeline.underConstruction : 0,
                  ready: d ? d.supplyPipeline.ready : 0,
                };
              })}
              source={{
                title: t_("market.compare.supplySplit"),
                source: "Community supply pipeline (project status records)",
                methodology: "Off-plan and under-construction projects counted together; ready = completed projects in the community registry.",
              }}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t_("market.compare.supply")}:{" "}
              {selectedCommunities
                .map((c) => {
                  const d = details[c.slug];
                  return `${c.name} — ${d ? `${formatNumber(d.supplyPipeline.totalProjects)} projects` : "loading…"}`;
                })
                .join(" · ")}
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedCommunities.map((c) => (
                <Link
                  key={c.slug}
                  to={`/communities/${c.slug}`}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md hover:text-brand-strong"
                >
                  {t_("market.compare.openCommunity").replace("{name}", c.name)}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

/**
 * Investor Command Center — /account/portfolio (V2 §25, U15).
 * Summary (MODELED labeling) → holdings CRUD → 2D map → cash flow → payment
 * schedule → construction tracker → documents → AI handoff. All data is
 * session-scoped server-side; this view only renders the API's deterministic
 * engine output.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { navigate } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { Breadcrumbs, SectionHeading, EmptyState, LoadingState, ErrorState, DataStateBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { t, localeOf } from "@/lib/i18n";
import { MapPin } from "lucide-react";
import { PortfolioSummary } from "@/components/account/portfolio-summary";
import { PortfolioHoldings } from "@/components/account/portfolio-holdings";
import { PortfolioCashflow } from "@/components/account/portfolio-cashflow";
import { PortfolioSchedule, PortfolioConstruction } from "@/components/account/portfolio-schedule";
import { PortfolioDocuments } from "@/components/account/portfolio-documents";
import { PortfolioAi } from "@/components/account/portfolio-ai";
import type { PortfolioData } from "@/components/account/portfolio-types";

/* §25.2/§28: 2D Leaflet, client-only — no 3D here (the atlas owns 3D). */
const PortfolioMap = dynamic(() => import("@/components/account/portfolio-map-inner"), {
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse rounded-xl bg-sand/60 sm:h-96" aria-hidden />,
});

export default function AccountPortfolioView() {
  const { user, loading } = useAuth();
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string, vars?: Record<string, string>) => {
    let s = t(key, locale);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };

  const [data, setData] = React.useState<PortfolioData | null>(null);
  const [error, setError] = React.useState(false);
  const [docsSignal, setDocsSignal] = React.useState(0);

  usePageMeta({ title: "Portfolio — Investor Command Center", noindex: true });

  const load = React.useCallback(() => {
    if (!user) return;
    setData(null);
    setError(false);
    api
      .get<PortfolioData>("/api/account/portfolio")
      .then((r) => {
        setData(r);
        setDocsSignal((n) => n + 1);
      })
      .catch(() => setError(true));
  }, [user]);

  React.useEffect(load, [load]);

  if (loading) return <div className="container-page py-12"><LoadingState /></div>;

  if (!user) {
    return (
      <div className="container-page py-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Portfolio" }]} />
        <div className="mt-8">
          <EmptyState
            title="Sign in to your command center"
            description="Your portfolio — holdings, cash flow, payment schedule and documents — lives behind your account. Browsing never requires one."
            actionLabel="Sign in"
            onAction={() => navigate("/account/login")}
          />
        </div>
      </div>
    );
  }

  const mappable = (data?.holdings ?? []).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Account", to: "/account" }, { label: "Portfolio" }]} />
      <div className="mt-4">
        <SectionHeading
          as="h1"
          kicker="Investor command center"
          title={t_("portfolio.title")}
          description={t_("portfolio.sub")}
          action={
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <DataStateBadge state="MODELED" />
              <span className="num">engine {data?.engineVersion ?? "—"}</span>
            </span>
          }
        />
      </div>

      {error && (
        <div className="mt-6">
          <ErrorState message="Couldn't load your portfolio." onRetry={load} />
        </div>
      )}

      {!error && data === null && <div className="mt-6"><LoadingState rows={3} /></div>}

      {!error && data !== null && (
        <div className="space-y-12">
          {/* §25.1 Portfolio summary */}
          <section aria-labelledby="pf-summary-heading">
            <h2 id="pf-summary-heading" className="sr-only">Portfolio summary</h2>
            <PortfolioSummary data={data} />
          </section>

          {/* Holdings CRUD */}
          <section aria-labelledby="pf-holdings-heading">
            <h2 id="pf-holdings-heading" className="sr-only">Holdings</h2>
            <PortfolioHoldings data={data} onRefresh={load} />
          </section>

          {/* §25.2 Portfolio map (2D) */}
          <section aria-labelledby="pf-map-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="pf-map-heading" className="font-display text-lg font-semibold">{t_("portfolio.map.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t_("portfolio.map.sub")}</p>
              </div>
              <span className="num text-xs text-muted-foreground">{mappable.length} mappable</span>
            </div>
            <div className="mt-4">
              {mappable.length === 0 ? (
                <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-sand/30 px-5 py-12 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" aria-hidden /> {t_("portfolio.map.empty")}
                </p>
              ) : (
                <PortfolioMap holdings={data.holdings} />
              )}
            </div>
          </section>

          {/* §25.3 Cash flow */}
          <section aria-labelledby="pf-cashflow-heading">
            <h2 id="pf-cashflow-heading" className="sr-only">Cash flow</h2>
            <PortfolioCashflow data={data} />
          </section>

          {/* §25.4 Payment schedule */}
          <section aria-labelledby="pf-schedule-heading">
            <h2 id="pf-schedule-heading" className="sr-only">Payment schedule</h2>
            <PortfolioSchedule data={data} />
          </section>

          {/* §25.5 Construction tracker */}
          <section aria-labelledby="pf-construction-heading">
            <h2 id="pf-construction-heading" className="sr-only">Construction tracker</h2>
            <PortfolioConstruction data={data} />
          </section>

          {/* §25.6 Documents */}
          <section aria-labelledby="pf-docs-heading">
            <h2 id="pf-docs-heading" className="sr-only">Documents</h2>
            <PortfolioDocuments holdings={data.holdings} refreshSignal={docsSignal} />
          </section>

          {/* §25.7 Portfolio AI */}
          <section aria-labelledby="pf-ai-heading">
            <h2 id="pf-ai-heading" className="sr-only">Portfolio AI</h2>
            <PortfolioAi data={data} />
          </section>

          <div className="flex flex-wrap gap-3 border-t border-border/60 pt-6">
            <Button asChild variant="outline" size="sm">
              <a href="/account">Back to account</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="/invest">Investment hub</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

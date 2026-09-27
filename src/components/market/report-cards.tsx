"use client";

/**
 * Research report cards V2 (U10 §19.7) — author, publication date, covered
 * period, source dates, methodology summary line, preview button (gated
 * mechanism preserved), download state and related-community/project chips
 * derived from the report text (title + summary) against the registries.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { ProvenanceBadge, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import type { CommunityCardLite, MarketReportCard } from "./market-types";
import { ShieldCheck, Download, Eye, MapPin, Building2 } from "lucide-react";

interface ProjectLite {
  slug: string;
  name: string;
}

function methodologyLine(text: string | null): string | null {
  if (!text) return null;
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return first.length > 150 ? `${first.slice(0, 147)}…` : first;
}

export function ReportCards() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const t_ = (key: string) => t(key, locale);
  const [reports, setReports] = React.useState<MarketReportCard[] | null>(null);
  const [communities, setCommunities] = React.useState<CommunityCardLite[]>([]);
  const [projects, setProjects] = React.useState<ProjectLite[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ reports: MarketReportCard[] }>("/api/market/reports")
      .then((r) => !cancelled && setReports(r.reports))
      .catch(() => !cancelled && setReports([]));
    api
      .get<{ communities: CommunityCardLite[] }>("/api/communities")
      .then((r) => !cancelled && setCommunities(r.communities))
      .catch(() => {});
    api
      .get<{ projects: ProjectLite[] }>("/api/projects?limit=48")
      .then((r) => !cancelled && setProjects(r.projects ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (reports === null) return <LoadingState rows={2} />;

  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No published reports yet.</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => {
        // Related communities/projects — matched from the report text, honestly
        // labeled "Mentions" (the fixture registry has no curated relations).
        const blob = (r.searchBlob ?? `${r.title} ${r.summary ?? ""}`).toLowerCase();
        const relatedCommunities = communities.filter((c) => blob.includes(c.name.toLowerCase())).slice(0, 4);
        const relatedProjects = projects.filter((p) => blob.includes(p.name.toLowerCase())).slice(0, 3);
        return (
          <article
            key={r.id}
            className="flex h-full flex-col rounded-xl border border-border/70 bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="kicker">{r.periodLabel || "Market report"}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  r.gated ? "bg-secondary text-muted-foreground" : "bg-success/10 text-success-foreground"
                }`}
              >
                {r.gated ? t_("market.reports.gated") : t_("market.reports.ungated")}
              </span>
            </div>
            <h3 className="mt-2 font-display text-lg font-semibold leading-snug">{r.title}</h3>
            <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">{r.summary}</p>

            {/* Methodology summary line (§19.7) */}
            {methodologyLine(r.methodology) && (
              <p className="mt-3 border-l-2 border-brand/40 pl-3 text-xs leading-relaxed text-muted-foreground">
                {t_("market.reports.methodologyLine").replace("{text}", methodologyLine(r.methodology) ?? "")}
              </p>
            )}

            {/* Provenance block: author, publication, covered period, source dates */}
            <div className="mt-4 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {t_("market.reports.author")} · {r.dataSourceName || "Source not supplied"}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ProvenanceBadge chip={r.isIllustrative ? { sourceType: "MANUAL", isIllustrative: true } : { sourceType: "MANUAL", sourceName: r.dataSourceName ?? undefined }} />
                {!r.isIllustrative && <span>Editorial source details; not independently verified.</span>}
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {r.publishedAt && <span>{t_("market.reports.published").replace("{date}", formatDate(r.publishedAt))}</span>}
                {r.periodLabel && (
                  <span>
                    {t_("market.reports.period")}: <span className="font-medium text-foreground/80">{r.periodLabel}</span>
                  </span>
                )}
                {r.retrievedAt && <span>{t_("market.reports.sourceDate").replace("{date}", formatDate(r.retrievedAt))}</span>}
              </p>
            </div>

            {/* Related communities / projects chips (§19.7) */}
            {(relatedCommunities.length > 0 || relatedProjects.length > 0) && (
              <div className="mt-3 flex flex-col gap-1.5 text-xs">
                {relatedCommunities.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t_("market.reports.related")}:
                    </span>
                    {relatedCommunities.map((c) => (
                      <Link
                        key={c.slug}
                        to={`/communities/${c.slug}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-ui hover:border-brand/50 hover:text-brand-strong"
                      >
                        <MapPin className="h-3 w-3" aria-hidden /> {c.name}
                      </Link>
                    ))}
                  </p>
                )}
                {relatedProjects.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t_("market.reports.related")}:
                    </span>
                    {relatedProjects.map((p) => (
                      <Link
                        key={p.slug}
                        to={`/projects/${p.slug}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-ui hover:border-brand/50 hover:text-brand-strong"
                      >
                        <Building2 className="h-3 w-3" aria-hidden /> {p.name}
                      </Link>
                    ))}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to={`/market/reports/${r.slug}`}>
                  <Eye className="h-4 w-4" aria-hidden /> {t_("market.reports.preview")}
                </Link>
              </Button>
              <Button asChild size="sm" className="gap-1.5">
                <Link
                  to={`/market/reports/${r.slug}`}
                >
                  <Download className="h-4 w-4" aria-hidden /> {t_("market.reports.read")}
                </Link>
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

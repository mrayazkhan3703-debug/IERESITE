"use client";

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { Link, navigate } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, GridSkeleton, SectionHeading, Price, LoadingState } from "@/components/common";
import { events } from "@/lib/analytics-tracker";
import { formatNumber } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { handoverPresentation, humanizeTitle } from "@/components/entity/entity-shared";
import { localeOf, t } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { CalendarClock, MapPin, Building2 } from "lucide-react";

interface ProjectCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  status: string;
  community: { id: string; name: string; slug: string };
  developer: { id: string; name: string; slug: string };
  startingPrice: { minor: string; currency: string } | null;
  handoverDate: string | null;
  completionPercent: number | null;
  cover: { url: string; altText: string | null; kind?: string; mimeType?: string; posterUrl?: string | null } | null;
  totalUnits: number | null;
}

export default function ProjectsView() {
  const [projects, setProjects] = React.useState<ProjectCard[] | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string | null>(null);
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  usePageMeta({
    title: "New Projects & Off-Plan Developments in Dubai",
    description:
      "Explore off-plan and new-launch developments across Dubai — payment plans with verification status, handover schedules, developer profiles and available units.",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "New projects in Dubai",
      numberOfItems: projects?.length,
    },
  });

  React.useEffect(() => {
    api
      .get<{ projects: ProjectCard[] }>(`/api/projects${statusFilter ? `?status=${statusFilter}` : ""}`)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, [statusFilter]);

  const statuses = ["OFF_PLAN", "UNDER_CONSTRUCTION", "READY"];

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "New Projects" }]} />
      <div className="mt-4">
        <SectionHeading as="h1"
          kicker="New launches & off-plan"
          title="Dubai's new developments, with the small print readable"
          description="Payment plans carry their verification status. Handover dates carry their source. Compare launches with the facts that matter."
        />
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          <button
            type="button"
            aria-pressed={statusFilter === null}
            onClick={() => setStatusFilter(null)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui ${statusFilter === null ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            All stages
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-ui ${statusFilter === s ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {s.replace(/_/g, " ").toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {projects === null ? (
        <GridSkeleton count={4} />
      ) : projects.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">No projects in this stage right now.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.slug}`}
              onClick={() => events.projectView(p.slug)}
              className="group relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.14)]"
            >
              <div className="aspect-[16/9] overflow-hidden bg-sand">
                {p.cover && mediaPreviewUrl(p.cover) && (
                  
                  <img
                    src={mediaPreviewUrl(p.cover) ?? undefined}
                    alt={p.cover.altText ?? `${p.name} — development render`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
              </div>
              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
                      p.status === "OFF_PLAN"
                        ? "bg-brand-soft text-brand-strong"
                        : p.status === "UNDER_CONSTRUCTION"
                          ? "bg-success/10 text-success"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {humanizeTitle(p.status)}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {p.community.name}
                  </span>
                </div>
                <h2 className="mt-2.5 font-display text-xl font-semibold text-ink group-hover:text-brand-strong">{p.name}</h2>
                {p.tagline && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{p.tagline}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  {p.startingPrice ? (
                    <span className="num">
                      <span className="text-xs text-muted-foreground">{t("common.from", locale)} </span>
                      <Price className="text-lg font-semibold text-brand-strong" price={{ minor: p.startingPrice.minor, currency: p.startingPrice.currency }} />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("project.similar.poa", locale)}</span>
                  )}
                  {/* Developer link — span + navigate, NOT a nested <a>
                      (the whole card is already a Link; a nested anchor is
                      invalid HTML and raised a React DOM-validity error). */}
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/developers/${p.developer.slug}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/developers/${p.developer.slug}`);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded text-xs text-muted-foreground/80 transition-ui hover:text-foreground focus-visible:text-foreground focus-visible:underline"
                  >
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    {p.developer.name}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {p.handoverDate &&
                    (() => {
                      const h = handoverPresentation(p.handoverDate);
                      return h ? (
                        <span className="flex items-center gap-1.5" title={h.fullLabel ?? undefined}>
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {t("project.summary.handover", locale)} {h.label}
                        </span>
                      ) : null;
                    })()}
                  {p.completionPercent !== null && p.completionPercent > 0 && (
                    <span className="num">{formatNumber(p.completionPercent)}% {t("developer.projects.complete", locale)}</span>
                  )}
                  {p.totalUnits && <span className="num">{formatNumber(p.totalUnits)} {t("project.similar.units", locale)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Project result card (V2 §12.1 Projects mode, U04) — simplified project card
 * for search results (developer / entry price / handover / status), following
 * the U03 off-plan radar card style. Only fields the projects API provides.
 */

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { Link } from "@/lib/router";
import { Building2, MapPin, Layers, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, fromMinor } from "@/lib/money";
import { formatAEDPrecise, fullValueTooltip } from "@/lib/format-precise";
import { UnavailableValue } from "@/components/common";
import type { ProjectCardDTO } from "@/lib/types";

const PROJECT_STATUS_LABEL_KEY: Record<string, string> = {
  OFF_PLAN: "search.project.status.offPlan",
  UNDER_CONSTRUCTION: "search.project.status.underConstruction",
  READY: "search.project.status.ready",
  COMPLETED: "search.project.status.completed",
  CANCELLED: "search.project.status.cancelled",
  ON_HOLD: "search.project.status.onHold",
};

/** ProjectCardDTO + the additive coordinates the projects API now returns. */
export interface ProjectResultDTO extends ProjectCardDTO {
  lat?: number;
  lng?: number;
}

function handoverQuarterLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export function ProjectResultCard({
  project,
  locale,
  className,
  id,
  onHover,
}: {
  project: ProjectResultDTO;
  locale: Locale;
  className?: string;
  /** Anchor id for map → list scroll sync. */
  id?: string;
  onHover?: (slug: string | null) => void;
}) {
  const price = project.startingPrice ? fromMinor(project.startingPrice.minor) : null;
  const handover = handoverQuarterLabel(project.handoverDate);
  const to = `/projects/${project.slug}`;

  return (
    <article
      id={id}
      onMouseEnter={() => onHover?.(project.slug)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card transition-ui hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_10px_30px_-12px_rgba(139,90,43,0.22)]",
        className
      )}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-sand">
        <Link to={to} aria-label={`${project.name} — ${t("search.project.viewProject", locale)}`} className="block h-full w-full">
          {project.cover ? (
            <img
              src={mediaPreviewUrl(project.cover) ?? undefined}
              alt={project.cover.altText || `${project.name}, ${project.community.name}`}
              loading="lazy"
              decoding="async"
              width={project.cover.width ?? 800}
              height={project.cover.height ?? 450}
              className="h-full w-full object-cover zoom-media"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
              <Building2 className="h-10 w-10" aria-hidden />
            </div>
          )}
        </Link>
        <div className="pointer-events-none absolute left-2 top-2">
          <span className="inline-flex items-center rounded-full border border-background/60 bg-background/85 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground backdrop-blur">
            {PROJECT_STATUS_LABEL_KEY[project.status]
              ? t(PROJECT_STATUS_LABEL_KEY[project.status], locale)
              : project.status.replace(/_/g, " ").toLowerCase()}
          </span>
        </div>
        {project.completionPercent != null && (
          <div className="pointer-events-none absolute inset-x-3 bottom-2.5">
            <div
              role="progressbar"
              aria-valuenow={Math.round(project.completionPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("search.project.progress", locale).replace("{n}", String(Math.round(project.completionPercent)))}
              className="h-1.5 overflow-hidden rounded-full bg-ink/30"
            >
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, project.completionPercent))}%` }} />
            </div>
            <p className="num mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/90 drop-shadow">
              {t("search.project.built", locale).replace("{n}", String(Math.round(project.completionPercent)))}
            </p>
          </div>
        )}
      </div>

      <Link to={to} className="block focus-visible:outline-offset-[-2px]">
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {price !== null && (
                <p className="num font-display text-xl font-semibold tracking-tight text-ink" title={fullValueTooltip(price)}>
                  <span className="text-xs font-normal text-muted-foreground">{t("search.project.cardFrom", locale)} </span>
                  {formatAEDPrecise(price)}
                </p>
              )}
              {handover && (
                <p className="text-xs font-medium text-muted-foreground">
                  {t("search.project.handover", locale)} {handover}
                </p>
              )}
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-ui group-hover:text-brand-strong rtl:rotate-180" aria-hidden />
          </div>

          <h3 className="truncate font-display text-[15px] font-medium leading-snug text-ink/90 group-hover:text-brand-strong">
            {project.name}
          </h3>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 truncate text-sm text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {project.community.name}
            </span>
            <span className="truncate">· {project.developer.name}</span>
          </p>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4" aria-hidden />
              <dt className="sr-only">{t("search.project.status", locale)}</dt>
              <dd className="num">
                {project.totalUnits != null ? (
                  `${formatNumber(project.totalUnits)} ${t("search.project.units", locale)}`
                ) : (
                  <UnavailableValue label={t("search.project.units", locale)} />
                )}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-xs">{t("search.project.status", locale)}:</dt>
              <dd className="text-xs font-medium text-foreground/80">
                {PROJECT_STATUS_LABEL_KEY[project.status]
                  ? t(PROJECT_STATUS_LABEL_KEY[project.status], locale)
                  : project.status.replace(/_/g, " ").toLowerCase()}
              </dd>
            </div>
          </dl>
        </div>
      </Link>
    </article>
  );
}

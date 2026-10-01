"use client";

/**
 * Off-Plan Launch Radar (V2 §11.6) — horizontally scrolling project cards.
 * Only fields the projects API actually provides; payment-plan summary and
 * verified source timestamp are omitted (not present in the list response)
 * rather than fabricated — the data state travels instead.
 */

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { DataStateBadge } from "@/components/common";
import { ChevronRight, Building2, MapPin, Layers } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, fromMinor } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import type { ProjectCardDTO } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  OFF_PLAN: "Off-plan",
  UNDER_CONSTRUCTION: "Under construction",
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
};

function handoverQuarter(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export function OffPlanRadar({ locale, projects }: { locale: Locale; projects: ProjectCardDTO[] | null }) {
  return (
    <section className="section-plain section" aria-labelledby="offplan-heading">
      <div className="container-page">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="kicker mb-2">{t("home.offplan.kicker", locale)}</p>
            <h2 id="offplan-heading" className="type-h2">
              {t("home.offplan.title", locale)}
            </h2>
            <p className="mt-2 text-balance text-muted-foreground">{t("home.offplan.subtitle", locale)}</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-brand-strong">
            <Link to="/projects">
              {t("home.offplan.viewAll", locale)} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>

        {projects === null ? (
          <div className="flex gap-5 overflow-hidden" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-72 min-w-[300px] animate-pulse rounded-xl bg-card/60 sm:min-w-[340px]" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-sand/30 px-6 py-10 text-center text-sm text-muted-foreground">
            No tracked launches right now.
          </p>
        ) : (
          <ul
            className="scroll-elegant grid grid-cols-1 gap-5 sm:-mx-6 sm:flex sm:snap-x sm:gap-5 sm:overflow-x-auto sm:px-6 lg:mx-0 lg:px-0"
            aria-label="Off-plan launches"
          >
            {projects.map((p) => {
              const price = p.startingPrice ? fromMinor(p.startingPrice.minor) : null;
              const quarter = handoverQuarter(p.handoverDate);
              const completion = p.completionPercent ?? null;
              return (
                <li key={p.id} className="min-w-0 sm:min-w-[340px] sm:snap-start lg:w-[calc(25%-15px)] lg:min-w-0">
                  <Link
                    to={`/projects/${p.slug}`}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-sand">
                      {p.cover ? (
                        <img
                          src={mediaPreviewUrl(p.cover) ?? undefined}
                          alt={p.cover.altText || `${p.name} — development render`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                          <Layers className="h-10 w-10" aria-hidden />
                        </div>
                      )}
                      <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                        <span className="rounded-[4px] bg-ink/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white backdrop-blur">
                          {STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-2.5 p-4">
                      <div>
                        <h3 className="truncate font-display text-base font-semibold text-ink group-hover:text-brand-strong">
                          {p.name}
                        </h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3 w-3" aria-hidden /> {p.developer.name}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden /> {p.community.name}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("home.offplan.from", locale)}</p>
                          <p className="data-value font-semibold text-ink" title={price !== null ? `Starting price ${formatAEDPrecise(price)}` : undefined}>
                            {price !== null ? formatAEDPrecise(price) : "—"}
                          </p>
                        </div>
                        {quarter && (
                          <div className="text-end">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("home.offplan.handover", locale)}</p>
                            <p className="num text-sm font-semibold text-ink">{quarter}</p>
                          </div>
                        )}
                      </div>

                      {completion !== null && (
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{t("home.offplan.construction", locale)}</span>
                            <span className="num">{formatNumber(completion)}%</span>
                          </div>
                          <div
                            className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"
                            role="progressbar"
                            aria-valuenow={completion}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${p.name} construction progress`}
                          >
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, completion))}%` }} />
                          </div>
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                        {p.totalUnits != null ? (
                          <span className="num text-xs text-muted-foreground">
                            {formatNumber(p.totalUnits)} {t("home.offplan.units", locale)}
                          </span>
                        ) : (
                          <span />
                        )}
                        <DataStateBadge state="ILLUSTRATIVE" />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

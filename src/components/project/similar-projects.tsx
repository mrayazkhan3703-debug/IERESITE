"use client";

/**
 * Similar projects (U07 — §15) with field-derived "Why similar" rows.
 *
 * Assembly is client-side per the §15 spec: same-community projects come from
 * /api/projects?community=; when the community has no other projects the
 * fallback pulls the wider list and ranks by real field overlap (developer,
 * budget ±30%, handover window ±12 months). Badges are derived from actual
 * fields — never editorial claims — and every card links to the project page.
 */

import * as React from "react";
import { api } from "@/lib/api-client";
import { Link } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { formatAEDPrecise } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { handoverPresentation, humanizeTitle, quarterLabel } from "@/components/entity/entity-shared";
import { MapPin, Building2, CalendarClock } from "lucide-react";
import type { SimilarProjectCard } from "./project-shared";

interface WhyRow {
  key: string;
  label: string;
}

export function SimilarProjects({
  project,
  locale = "en",
  limit = 3,
}: {
  project: {
    slug: string;
    community: { slug: string; name: string };
    developer: { slug: string; name: string };
    startingPriceMinor: string | null;
    handoverDate: string | null;
    status: string;
  };
  locale?: Locale;
  limit?: number;
}) {
  const [similar, setSimilar] = React.useState<SimilarProjectCard[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ projects: SimilarProjectCard[] }>(`/api/projects?community=${encodeURIComponent(project.community.slug)}&limit=8`)
      .then(async (r) => {
        if (cancelled) return;
        let list = (r.projects ?? []).filter((p) => p.slug !== project.slug);
        if (list.length === 0) {
          /* Fallback: wider list ranked by field overlap */
          const all = await api.get<{ projects: SimilarProjectCard[] }>("/api/projects?limit=24");
          if (cancelled) return;
          const price = project.startingPriceMinor ? Number(project.startingPriceMinor) : null;
          const handover = project.handoverDate ? Date.parse(project.handoverDate) : null;
          list = (all.projects ?? [])
            .filter((p) => p.slug !== project.slug)
            .map((p) => {
              let score = 0;
              if (p.developer.slug === project.developer.slug) score += 3;
              if (p.community.slug === project.community.slug) score += 5;
              const pPrice = p.startingPrice ? Number(p.startingPrice.minor) : null;
              if (price && pPrice && Math.abs(pPrice - price) / price <= 0.3) score += 2;
              const pH = p.handoverDate ? Date.parse(p.handoverDate) : null;
              if (handover && pH && Math.abs(pH - handover) <= 365 * 24 * 3600 * 1000) score += 1;
              if (p.status === project.status) score += 1;
              return { p, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((x) => x.p);
        }
        setSimilar(list.slice(0, limit));
      })
      .catch(() => !cancelled && setSimilar([]));
    return () => {
      cancelled = true;
    };
  }, [project.slug, project.community.slug]);

  if (similar === null || similar.length === 0) return null;

  const priceMajor = project.startingPriceMinor ? Number(project.startingPriceMinor) / 100 : null;
  const handoverMs = project.handoverDate ? Date.parse(project.handoverDate) : null;

  const whySimilar = (p: SimilarProjectCard): WhyRow[] => {
    const rows: WhyRow[] = [];
    if (p.community.slug === project.community.slug) {
      rows.push({ key: "community", label: t("project.similar.sameCommunity", locale).replace("{c}", p.community.name) });
    }
    if (p.developer.slug === project.developer.slug) {
      rows.push({ key: "developer", label: t("project.similar.sameDeveloper", locale).replace("{d}", p.developer.name) });
    }
    const pPrice = p.startingPrice ? Number(p.startingPrice.minor) / 100 : null;
    if (priceMajor && pPrice && priceMajor > 0 && Math.abs(pPrice - priceMajor) / priceMajor <= 0.3) {
      rows.push({ key: "budget", label: t("project.similar.similarBudget", locale) });
    }
    const pH = p.handoverDate ? Date.parse(p.handoverDate) : null;
    if (handoverMs && pH && Math.abs(pH - handoverMs) <= 365 * 24 * 3600 * 1000) {
      rows.push({ key: "handover", label: t("project.similar.handoverWindow", locale).replace("{q}", quarterLabel(p.handoverDate) ?? "") });
    }
    if (rows.length === 0) rows.push({ key: "status", label: t("project.similar.sameStage", locale).replace("{s}", humanizeTitle(p.status)) });
    return rows;
  };

  return (
    <section aria-labelledby="similar-heading">
      <h2 id="similar-heading" className="font-display text-xl font-semibold">{t("project.similar.title", locale)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("project.similar.sub", locale)}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {similar.map((p) => {
          const why = whySimilar(p);
          const price = p.startingPrice ? Number(p.startingPrice.minor) / 100 : null;
          const handover = handoverPresentation(p.handoverDate);
          return (
            <Link
              key={p.id}
              to={`/projects/${p.slug}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md"
            >
              <div className="aspect-[16/9] overflow-hidden bg-sand">
                {p.cover && (
                  <img
                    src={p.cover.url}
                    alt={p.cover.altText ?? `${p.name} — development render`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display font-semibold leading-tight group-hover:text-brand-strong">{p.name}</h3>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold capitalize text-muted-foreground">
                    {humanizeTitle(p.status)}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {p.community.name}</span>
                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3" aria-hidden /> {p.developer.name}</span>
                </p>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  {price !== null ? (
                    <span className="num font-semibold text-brand-strong" title={t("project.similar.fromPrice", locale)}>
                      {t("common.from", locale)} {formatAEDPrecise(price)}
                    </span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground/70">{t("project.similar.poa", locale)}</span>
                  )}
                  {handover && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground" title={handover.fullLabel ?? undefined}>
                      <CalendarClock className="h-3 w-3" aria-hidden /> {t("project.summary.handover", locale)} {handover.label}
                    </span>
                  )}
                  {p.totalUnits && <span className="num text-xs text-muted-foreground">{formatNumber(p.totalUnits)} {t("project.similar.units", locale)}</span>}
                </div>
                {/* Why similar — derived from real fields */}
                <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3" aria-label={t("project.similar.whyAria", locale)}>
                  {why.map((w) => (
                    <li
                      key={w.key}
                      className="rounded-full border border-brand/25 bg-brand-faint px-2.5 py-0.5 text-[11px] font-medium text-brand-strong"
                    >
                      {w.label}
                    </li>
                  ))}
                </ul>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

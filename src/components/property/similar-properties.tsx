"use client";

/**
 * Similar properties V2 (V2 §14.11) — meaningful recommendations with an
 * explained "Why similar" line derived from actual field comparisons:
 * budget within ±20%, same bedroom count, same community, same property type.
 *
 * Primary source: the detail API's `similar` array. When it comes back empty,
 * the section falls back to assembling candidates client-side from
 * /api/properties?community=X&bedsMin=Y&limit=3.
 */

import * as React from "react";
import { SectionHeading } from "@/components/common";
import { PropertyCard } from "@/components/property/property-card";
import { api } from "@/lib/api-client";
import { fromMinor } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import type { ListingCardDTO } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export interface SimilarContext {
  currentSlug: string;
  priceMinor: string | null;
  bedrooms: number;
  communitySlug: string;
  propertyType: string;
}

/** Derive the honest "Why similar" line from comparable fields (§14.11). */
export function whySimilar(candidate: ListingCardDTO, ctx: SimilarContext, locale: Locale = "en"): string[] {
  const reasons: string[] = [];
  const candidateMajor = fromMinor(candidate.price.minor);
  const currentMajor = ctx.priceMinor ? fromMinor(ctx.priceMinor) : null;

  if (currentMajor && currentMajor > 0 && Math.abs(candidateMajor - currentMajor) / currentMajor <= 0.2) {
    reasons.push(t("property.similar.reasonBudget", locale));
  }
  if (candidate.bedrooms === ctx.bedrooms) {
    reasons.push(candidate.bedrooms === 0 ? t("property.similar.reasonStudio", locale) : t("property.similar.reasonBeds", locale));
  }
  if (candidate.community.slug === ctx.communitySlug) {
    reasons.push(t("property.similar.reasonCommunity", locale));
  }
  if (candidate.propertyType === ctx.propertyType) {
    reasons.push(t("property.similar.reasonType", locale));
  }
  if (reasons.length === 0) reasons.push(t("property.similar.reasonNearby", locale));
  return reasons;
}

export function SimilarProperties({
  similar,
  context,
  locale = "en",
}: {
  similar: ListingCardDTO[];
  context: SimilarContext;
  locale?: Locale;
}) {
  const [fallback, setFallback] = React.useState<ListingCardDTO[] | null>(null);
  const exhausted = similar.length === 0;

  React.useEffect(() => {
    if (!exhausted) return;
    let cancelled = false;
    api
      .get<{ results: ListingCardDTO[] }>(
        `/api/properties?community=${encodeURIComponent(context.communitySlug)}&bedsMin=${Math.max(0, context.bedrooms - 1)}&limit=3`
      )
      .then((res) => {
        if (cancelled) return;
        setFallback((res?.results ?? []).filter((r) => r.slug !== context.currentSlug).slice(0, 3));
      })
      .catch(() => !cancelled && setFallback([]));
    return () => {
      cancelled = true;
    };
  }, [exhausted, context.communitySlug, context.bedrooms, context.currentSlug]);

  const list = exhausted ? (fallback ?? []) : similar;

  if (list.length === 0) return null;

  return (
    <section className="container-page mt-14 print:hidden" aria-labelledby="similar-heading">
      <SectionHeading kicker={t("property.similar.kicker", locale)} title={t("property.similar.title", locale)} id="similar-heading" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {list.slice(0, 6).map((s) => {
          const reasons = whySimilar(s, context, locale);
          return (
            <div key={s.id} className="flex min-w-0 flex-col gap-2">
              <PropertyCard listing={s} />
              <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label={t("property.similar.whyAria", locale)}>
                <span className="font-medium uppercase tracking-wide text-[10px] text-brand-strong">{t("property.similar.why", locale)}</span>
                {reasons.map((r) => (
                  <Badge key={r} variant="secondary" className="px-2 py-0.5 text-[10px] font-normal">
                    {r}
                  </Badge>
                ))}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

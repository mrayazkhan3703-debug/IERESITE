"use client";

/**
 * Curated Properties V2 (V2 §11.5) — featured grid rendered with the upgraded
 * property card (progressive disclosure evidence layer). Section shell stays
 * lean; the evidence lives inside each card.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { GridSkeleton } from "@/components/common";
import { PropertyCard, type PropertyCommunityContext } from "@/components/property/property-card";
import { ChevronRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { ListingCardDTO } from "@/lib/types";

export function CuratedProperties({
  locale,
  featured,
  contextFor,
}: {
  locale: Locale;
  featured: ListingCardDTO[] | null;
  contextFor: (communitySlug: string) => PropertyCommunityContext | undefined;
}) {
  return (
    <section className="section-plain section" aria-labelledby="curated-heading">
      <div className="container-page">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="kicker kicker-accent mb-2">{t("home.properties.kicker", locale)}</p>
            <h2 id="curated-heading" className="type-h2">
              {t("home.properties.title", locale)}
            </h2>
            <p className="mt-2 text-balance text-muted-foreground">{t("home.properties.subtitle", locale)}</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-brand-strong">
            <Link to="/properties">
              {t("home.properties.viewAll", locale)} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>

        {featured === null ? (
          <GridSkeleton count={3} />
        ) : featured.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-sand/30 px-6 py-10 text-center text-sm text-muted-foreground">
            No featured listings right now — the desk refreshes this selection as inventory changes.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.slice(0, 6).map((l) => (
              <PropertyCard key={l.id} listing={l} communityContext={contextFor(l.community.slug)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

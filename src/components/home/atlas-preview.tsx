"use client";

/**
 * Dubai Investment Atlas preview (V2 §11.4) — dark full-width band with a
 * layer list and a lightweight SVG coastline schematic. Dot positions use a
 * linear projection of the communities' REAL lat/lng, so relative geography
 * is truthful; the coastline itself is an editorial schematic. Costs zero
 * extra JS bundles (no second Leaflet instance) and degrades gracefully.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Home, Building2, TrendingUp, Wallet, Sun, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber, formatMoney } from "@/lib/money";
import { CHART_COLORS } from "@/lib/chart-theme";
import type { CommunityCardDTO, ProjectCardDTO } from "@/lib/types";
import type { CommunityMetricSet } from "@/components/home/use-home-data";

type AtlasLayer = "properties" | "projects" | "market" | "rental" | "lifestyle";

const LAYER_META: {
  key: AtlasLayer;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  { key: "properties", labelKey: "home.hero.layer.properties", icon: Home, description: "Listing inventory counts by community" },
  { key: "projects", labelKey: "home.hero.layer.projects", icon: Building2, description: "Tracked off-plan launches by community" },
  { key: "market", labelKey: "home.hero.layer.market", icon: TrendingUp, description: "Modeled average AED/sqft asking levels" },
  { key: "rental", labelKey: "home.hero.layer.rental", icon: Wallet, description: "Modeled 1BR annual rent context" },
  { key: "lifestyle", labelKey: "home.hero.layer.lifestyle", icon: Sun, description: "Lifestyle character tags per community" },
];

/* Linear projection of real community coordinates into the panel — the
   relative geography is truthful even though the coastline is schematic. */
const VB_W = 620;
const VB_H = 360;
const project = (lng: number, lat: number): [number, number] => [
  (lng - 55.13) * 2350 + 40,
  (25.23 - lat) * 1350 + 30,
];

const COAST_PATH =
  "M -10,300 C 30,285 48,272 64,232 C 76,206 84,192 100,178 C 130,152 170,132 216,118 C 260,105 292,96 312,90 C 352,79 402,58 463,30 C 502,13 545,0 632,-12";

interface AtlasDot {
  slug: string;
  name: string;
  x: number;
  y: number;
  r: number;
  value: string;
}

export function AtlasPreview({
  locale,
  communities,
  communityMetrics,
  projects,
}: {
  locale: Locale;
  communities: CommunityCardDTO[] | null;
  communityMetrics: Record<string, CommunityMetricSet> | null;
  projects: ProjectCardDTO[] | null;
}) {
  const [active, setActive] = React.useState<AtlasLayer>("properties");

  const dots: AtlasDot[] = React.useMemo(() => {
    if (!communities) return [];
    const projectCounts = new Map<string, number>();
    for (const p of projects ?? []) {
      projectCounts.set(p.community.slug, (projectCounts.get(p.community.slug) ?? 0) + 1);
    }
    return communities.map((c) => {
      const [x, y] = project(c.lng, c.lat);
      const m = communityMetrics?.[c.slug];
      let r = 6;
      let value = "—";
      switch (active) {
        case "properties":
          r = 4 + Math.min(12, (c.listingCount ?? 0) * 0.4);
          value = `${formatNumber(c.listingCount ?? 0)} listings`;
          break;
        case "projects": {
          const n = projectCounts.get(c.slug) ?? 0;
          r = n > 0 ? 6 + Math.min(6, n * 2) : 3.5;
          value = n > 0 ? `${formatNumber(n)} tracked ${n === 1 ? "project" : "projects"}` : "none tracked";
          break;
        }
        case "market":
          r = m?.avgPricePerSqft ? 4 + Math.min(9, (m.avgPricePerSqft - 900) / 300) : 3.5;
          value = m?.avgPricePerSqft
            ? `${formatMoney(String(Math.round(m.avgPricePerSqft * 100)), { currency: "AED", compact: true })}/sqft · modeled`
            : "not provided";
          break;
        case "rental":
          r = m?.avgRent1Br ? 4 + Math.min(9, (m.avgRent1Br - 50_000) / 14_000) : 3.5;
          value = m?.avgRent1Br
            ? `${formatMoney(String(Math.round(m.avgRent1Br * 100)), { currency: "AED", compact: true })}/yr · modeled`
            : "not provided";
          break;
        case "lifestyle":
          r = 6;
          value = c.lifestyleTags?.slice(0, 2).join(" · ") || "not provided";
          break;
      }
      return { slug: c.slug, name: c.name, x, y, r, value };
    });
  }, [communities, communityMetrics, projects, active]);

  const palmCenter = project(55.139, 25.112);

  return (
    <section className="section-ink section" aria-labelledby="atlas-heading">
      <div className="container-page">
        {/* §18.4 — mobile DOM order: heading → map → layer controls → CTA;
            desktop: heading + controls stacked in the left 5 columns, schematic
            map spanning both rows on the right (V2 composition). */}
        <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-1">
            <p className="kicker mb-2 text-white/50">{t("home.atlas.kicker", locale)}</p>
            <h2 id="atlas-heading" className="type-h2 on-ink">
              {t("home.atlas.title", locale)}
            </h2>
            <p className="mt-3 max-w-md text-balance text-muted-foreground">{t("home.atlas.subtitle", locale)}</p>
          </div>

          {/* Schematic map panel — map-first on mobile */}
          <div className="min-w-0 self-center lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
            <div className="overflow-hidden rounded-xl border border-white/12 bg-white/[0.03]">
              <svg
                viewBox={`0 0 ${VB_W} ${VB_H}`}
                className="block h-auto w-full"
                role="img"
                aria-label={`Schematic Dubai map — ${LAYER_META.find((l) => l.key === active)?.description}`}
              >
                <defs>
                  <pattern id="atlas-sea" width="16" height="16" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1" fill="rgba(247,242,233,0.14)" />
                  </pattern>
                </defs>

                {/* Sea — NW of the coast curve */}
                <path d={`${COAST_PATH} L 632,-12 L -10,-12 Z`} fill="url(#atlas-sea)" />
                <path d={COAST_PATH} fill="none" stroke="rgba(247,242,233,0.45)" strokeWidth="1.4" />

                {/* Palm Jumeirah schematic */}
                <circle cx={palmCenter[0]} cy={palmCenter[1]} r="15" fill="none" stroke="rgba(247,242,233,0.35)" strokeWidth="1.1" />
                <path
                  d={`M ${palmCenter[0] + 3},${palmCenter[1] + 22} L ${palmCenter[0] + 1},${palmCenter[1] + 10}`}
                  stroke="rgba(247,242,233,0.35)"
                  strokeWidth="1.6"
                  fill="none"
                />

                {/* Dubai Creek notch */}
                <path
                  d="M 372,72 C 376,82 370,90 375,100"
                  stroke="rgba(247,242,233,0.3)"
                  strokeWidth="1.2"
                  fill="none"
                />

                {/* Community dots at real projected coordinates — fill via
                    chart-theme tokens (style props resolve var(); the ink
                    section keeps the bronze readable in both themes). */}
                {dots.map((d) => (
                  <g key={d.slug}>
                    <circle
                      cx={d.x}
                      cy={d.y}
                      r={d.r}
                      style={{ fill: CHART_COLORS[0], fillOpacity: 0.85, stroke: "rgba(247,242,233,0.75)", strokeWidth: 1 }}
                    />
                    <title>{`${d.name} — ${d.value}`}</title>
                    <text x={d.x + d.r + 5} y={d.y - 2} fontSize="10.5" fill="rgba(247,242,233,0.88)" fontWeight="600">
                      {d.name}
                    </text>
                    <text x={d.x + d.r + 5} y={d.y + 9} fontSize="9" fill="rgba(196,152,98,0.9)">
                      {d.value}
                    </text>
                  </g>
                ))}

                {dots.length === 0 && (
                  <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" fontSize="12" fill="rgba(247,242,233,0.5)">
                    Loading community coordinates…
                  </text>
                )}
              </svg>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("home.atlas.schematic", locale)}</p>
          </div>

          {/* Layer controls (compact below sm) + full-screen map CTA */}
          <div className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-2">
            <ul className="space-y-1.5" aria-label="Atlas layers">
              {LAYER_META.map((layer) => {
                const isActive = active === layer.key;
                return (
                  <li key={layer.key}>
                    <button
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActive(layer.key)}
                      className={cn(
                        "flex w-full items-center gap-3.5 rounded-lg border px-3.5 py-2.5 text-start transition-ui sm:px-4 sm:py-3",
                        isActive
                          ? "border-brand/50 bg-brand-soft/40"
                          : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"
                      )}
                    >
                      <layer.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-brand" : "text-muted-foreground")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm font-semibold", isActive ? "text-brand" : "on-ink")}>
                          {t(layer.labelKey, locale)}
                        </span>
                        <span className="hidden truncate text-xs text-muted-foreground sm:block">{layer.description}</span>
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full transition-colors",
                          isActive ? "bg-brand" : "bg-white/15"
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex flex-wrap items-center gap-4 lg:mt-7">
              <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
                <Link to="/properties/map">
                  {t("home.atlas.openFull", locale)} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">{t("home.atlas.previewNote", locale)}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

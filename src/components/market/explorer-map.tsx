"use client";

/**
 * Explorer map mode (U10 §19.4) — community heat circles over the aggregated
 * transaction/rent counts. Circle radius scales with record count; color
 * encodes the median value (bronze ramp). Leaflet is imported directly here —
 * the parent lazy-loads this module via next/dynamic ssr:false.
 *
 * Area → community coordinate join: transaction areaNames are matched against
 * the communities registry by name (with common abbreviations); areas without
 * a coordinate stay in the table only — reported, never approximated.
 */

import * as React from "react";
import { MapContainer, TileLayer, Circle, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import { MAP_TILE_CONFIG } from "@/lib/map-tiles";
import "leaflet/dist/leaflet.css";
import { formatMoney, formatNumber } from "@/lib/money";
import type { CommunityCardLite, MarketAreaAgg } from "./market-types";

/* Resolved brand hexes (SVG/HTML presentation attributes cannot host var()). */
const RAMP_LOW = "#d9c1a3";
const RAMP_HIGH = "#8f5a2b";

/** Known areaName aliases that don't equal their community display name. */
const AREA_ALIASES: Record<string, string> = {
  JVC: "Jumeirah Village Circle",
  "Jumeirah Village Circle": "Jumeirah Village Circle",
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function resolveCommunityName(areaName: string): string {
  return AREA_ALIASES[areaName] ?? areaName;
}

export interface ExplorerMapPoint {
  areaName: string;
  communityName: string;
  lat: number;
  lng: number;
  count: number;
  medianMinor: number | null;
}

export function buildMapPoints(areas: MarketAreaAgg[], communities: CommunityCardLite[]): ExplorerMapPoint[] {
  const byNormalizedName = new Map<string, CommunityCardLite>();
  for (const c of communities) {
    if (typeof c.lat === "number" && typeof c.lng === "number") {
      byNormalizedName.set(normalize(c.name), c);
    }
  }
  const points: ExplorerMapPoint[] = [];
  for (const a of areas) {
    const match = byNormalizedName.get(normalize(resolveCommunityName(a.areaName)));
    if (!match) continue;
    const medianStr = a.medianAmountMinor ?? a.medianRentMinor ?? null;
    points.push({
      areaName: a.areaName,
      communityName: match.name,
      lat: match.lat as number,
      lng: match.lng as number,
      count: a.count,
      medianMinor: medianStr !== null ? Number(medianStr) : null,
    });
  }
  return points;
}

function FitBounds({ points }: { points: ExplorerMapPoint[] }) {
  const map = useMap();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (fitted.current || points.length === 0) return;
    fitted.current = true;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
    } else {
      const lats = points.map((p) => p.lat);
      const lngs = points.map((p) => p.lng);
      map.fitBounds(
        [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ],
        { padding: [48, 48] }
      );
    }
  }, [points, map]);
  return null;
}

export function ExplorerMap({
  points,
  variant,
  unmatchedAreas,
  title,
  note,
}: {
  points: ExplorerMapPoint[];
  variant: "transactions" | "rents";
  unmatchedAreas: number;
  title: string;
  note: string;
}) {
  const isTx = variant === "transactions";
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const medians = points.map((p) => p.medianMinor).filter((m): m is number => m !== null);
  const minMed = medians.length ? Math.min(...medians) : 0;
  const maxMed = medians.length ? Math.max(...medians) : 0;

  const radiusFor = (count: number): number => 900 + (count / maxCount) * 2600;
  const colorFor = (median: number | null): string => {
    if (median === null || maxMed <= minMed) return RAMP_HIGH;
    const t = (median - minMed) / (maxMed - minMed);
    // Simple 2-stop lerp between resolved hex ramp values
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    const parse = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const [r1, g1, b1] = parse(RAMP_LOW);
    const [r2, g2, b2] = parse(RAMP_HIGH);
    return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border border-border" style={{ background: RAMP_LOW }} aria-hidden /> low median
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border border-border" style={{ background: RAMP_HIGH }} aria-hidden /> high median
          </span>
        </div>
      </div>
      <div className="mt-3 h-[340px] w-full overflow-hidden rounded-lg border border-border/60 sm:h-[400px]">
        <MapContainer center={[25.15, 55.22]} zoom={11} scrollWheelZoom={false} className="h-full w-full" aria-label={title}>
          <TileLayer
            attribution={MAP_TILE_CONFIG.attribution}
            url={MAP_TILE_CONFIG.url}
            maxZoom={MAP_TILE_CONFIG.maxZoom}
          />
          <FitBounds points={points} />
          {points.map((p) => (
            <Circle
              key={p.areaName}
              center={[p.lat, p.lng]}
              radius={radiusFor(p.count)}
              pathOptions={{
                color: colorFor(p.medianMinor),
                fillColor: colorFor(p.medianMinor),
                fillOpacity: 0.35,
                weight: 1.5,
              }}
            >
              <LeafletTooltip>
                <span className="text-xs">
                  <strong>{p.areaName}</strong>
                  <br />
                  {formatNumber(p.count)} {isTx ? "transactions" : "contracts"}
                  {p.medianMinor !== null && (
                    <>
                      <br />
                      median {formatMoney(String(p.medianMinor), { currency: "AED", compact: true })}
                    </>
                  )}
                </span>
              </LeafletTooltip>
            </Circle>
          ))}
        </MapContainer>
      </div>
      {unmatchedAreas > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {unmatchedAreas} area{unmatchedAreas === 1 ? "" : "s"} without mapped coordinates appear{unmatchedAreas === 1 ? "s" : ""} in
          the community table only — locations are never approximated.
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Circle positions are community centroids from the platform registry; circle size and color are derived from the
        current filter. Illustrative fixtures pending the DLD import.
      </p>
    </div>
  );
}

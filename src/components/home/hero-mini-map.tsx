"use client";

/**
 * Hero mini-map (V2 §11.1) — react-leaflet preview of Dubai communities.
 * Loaded ONLY via next/dynamic (ssr:false) when the panel enters the viewport
 * on a lg+ screen, so it never costs first-paint JS on mobile.
 *
 * Marker colors: resolved hex equivalents of the --ie-viz-* bronze tokens
 * (SVG presentation attributes cannot host CSS var() references; recharts
 * surfaces consume chart-theme.ts directly).
 */

import * as React from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { formatNumber, formatMoney } from "@/lib/money";
import { MAP_TILE_CONFIG } from "@/lib/map-tiles";

/* Brand bronze (--ie-viz-1) and ivory, resolved for SVG attributes. */
const MARKER_FILL = "#8f5a2b";
const MARKER_STROKE = "#f7f2e9";
const MARKER_SELECTED = "#b07a3f";

export type MapLayer = "properties" | "projects" | "market" | "rental" | "lifestyle";

export interface MiniMapCommunity {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  listingCount?: number;
  projectsCount?: number;
  avgPricePerSqft?: number;
  avgRent1Br?: number;
  yieldPct?: number;
  lifestyleTags?: string[];
}

const DUBAI_CENTER: [number, number] = [25.13, 55.2];

export default function HeroMiniMap({
  communities,
  selectedSlug,
  onSelect,
  activeLayer,
}: {
  communities: MiniMapCommunity[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  activeLayer: MapLayer;
}) {
  const mapRef = React.useRef<HTMLDivElement | null>(null);

  /* U21 a11y (§43 maps): Leaflet interactive SVG paths receive pointer
   * listeners and Chrome therefore tabs into them — unnamed, duplicating the
   * adjacent community chip buttons. Take them out of the tab order and AT
   * tree; mouse hover/click behavior is unchanged. Also: react-leaflet v5
   * drops non-className/style props, so the focusable .leaflet-container
   * (tabindex=0, keyboard panning) gets its role+label applied here. */
  React.useEffect(() => {
    const root = mapRef.current;
    if (!root) return;
    const mute = () => {
      const container = root.querySelector(".leaflet-container");
      if (container && !container.getAttribute("aria-label")) {
        container.setAttribute("role", "application");
        container.setAttribute("aria-label", "Dubai community map preview");
      }
      root.querySelectorAll<SVGPathElement>(".leaflet-overlay-pane path.leaflet-interactive").forEach((p) => {
        p.setAttribute("tabindex", "-1");
        p.setAttribute("aria-hidden", "true");
      });
    };
    mute();
    const mo = new MutationObserver(mute);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [communities, selectedSlug, activeLayer]);

  const tooltipFor = (c: MiniMapCommunity) => {
    switch (activeLayer) {
      case "market":
        return c.avgPricePerSqft
          ? `${c.name} — ${formatMoney(String(Math.round(c.avgPricePerSqft * 100)), { currency: "AED", compact: true })}/sqft (modeled)`
          : `${c.name} — market figure not provided`;
      case "rental":
        return c.avgRent1Br
          ? `${c.name} — 1BR rent ${formatMoney(String(Math.round(c.avgRent1Br * 100)), { currency: "AED", compact: true })}/yr (modeled)`
          : `${c.name} — rent figure not provided`;
      case "projects":
        return `${c.name} — ${c.projectsCount ?? 0} tracked off-plan ${c.projectsCount === 1 ? "project" : "projects"}`;
      case "lifestyle":
        return `${c.name} — ${c.lifestyleTags?.slice(0, 3).join(" · ") || "lifestyle tags not provided"}`;
      default:
        return `${c.name} — ${formatNumber(c.listingCount ?? 0)} listings`;
    }
  };

  return (
    <div ref={mapRef} className="h-full w-full">
    <MapContainer
      center={DUBAI_CENTER}
      zoom={11}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={false}
      dragging={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
      className="h-full w-full"
      style={{ background: "#efe9dd" }}
      aria-label="Dubai community map preview"
    >
      <TileLayer
        url={MAP_TILE_CONFIG.url}
        maxZoom={MAP_TILE_CONFIG.maxZoom}
        attribution={MAP_TILE_CONFIG.attribution}
      />
      {communities.map((c) => {
        const selected = c.slug === selectedSlug;
        return (
          <CircleMarker
            key={c.slug}
            center={[c.lat, c.lng]}
            radius={selected ? 11 : 7}
            /* U21 a11y: preview markers duplicate the adjacent community chip
             * buttons — keep them out of the tab order (no accessible name on
             * Leaflet SVG paths) so the keyboard path stays on real controls. */
            pathOptions={{
              fillColor: selected ? MARKER_SELECTED : MARKER_FILL,
              fillOpacity: selected ? 0.95 : 0.82,
              color: MARKER_STROKE,
              weight: selected ? 2.5 : 1.5,
            }}
            eventHandlers={{ click: () => onSelect(selected ? null : c.slug) }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              {tooltipFor(c)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
    </div>
  );
}

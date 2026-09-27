"use client";

/**
 * Embedded results map (V2 §12.4, U04) — the right-hand synchronized Leaflet
 * panel of the search split view (and the mobile full-screen map sheet).
 * Loaded via next/dynamic ssr:false only when a map is actually shown.
 *
 * Map/list sync: hovering a result card highlights its marker; clicking a
 * marker asks the parent to scroll the list to the matching card. Clusters
 * zoom in.
 */

import * as React from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatNumber } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { CHART_COLORS } from "@/lib/chart-theme";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MAP_TILE_CONFIG } from "@/lib/map-tiles";

/* Resolved brand hex (SVG/HTML presentation attributes cannot host var()). */
const MARKER_BRONZE = "#8f5a2b";
const MARKER_PROJECT = CHART_COLORS[1];

export interface MapMarkerItem {
  kind: "property" | "project";
  slug: string;
  lat: number;
  lng: number;
  /** Compact price label for the pill. */
  label: string;
  /** Title for tooltip/aria. */
  title: string;
  sublabel?: string;
}

interface Cluster {
  lat: number;
  lng: number;
  items: MapMarkerItem[];
}

/** Grid clustering — cell size halves per zoom level, bounded. */
function clusterGrid(items: MapMarkerItem[], zoom: number): Cluster[] {
  const cell = Math.min(0.35, Math.max(0.0025, 0.3 / Math.pow(2, Math.max(0, zoom - 8))));
  const cells = new Map<string, Cluster>();
  for (const it of items) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue;
    const key = `${Math.floor(it.lat / cell)}:${Math.floor(it.lng / cell)}`;
    let c = cells.get(key);
    if (!c) {
      c = { lat: 0, lng: 0, items: [] };
      cells.set(key, c);
    }
    c.items.push(it);
  }
  for (const c of cells.values()) {
    c.lat = c.items.reduce((s, i) => s + i.lat, 0) / c.items.length;
    c.lng = c.items.reduce((s, i) => s + i.lng, 0) / c.items.length;
  }
  return [...cells.values()];
}

function markerIcon(cluster: Cluster, highlighted: boolean): L.DivIcon {
  const single = cluster.items.length === 1;
  const it = single ? cluster.items[0] : null;
  const isProject = it?.kind === "project";
  const bg = isProject ? MARKER_PROJECT : MARKER_BRONZE;
  const cls = single
    ? cn(
        "num flex items-center justify-center whitespace-nowrap rounded-full border-2 px-2.5 py-1 text-xs font-semibold shadow-md transition-transform",
        highlighted
          ? "scale-125 border-ink bg-ink text-white"
          : "border-white bg-card text-brand-strong hover:scale-110"
      )
    : cn(
        "num flex items-center justify-center rounded-full border-2 border-white px-2.5 py-1 text-sm font-semibold shadow-md transition-transform hover:scale-110",
        highlighted && "scale-110"
      );
  const style = single && !highlighted ? "" : `background-color:${bg};color:#fff;`;
  const text = single ? it!.label : formatNumber(cluster.items.length);
  return L.divIcon({
    html: `<div class="${cls}" style="${style}">${text}</div>`,
    className: "",
    iconSize: [0, 0],
  });
}

function MapInner({
  items,
  hoveredSlug,
  selectedSlug,
  onSelect,
  locale,
  onViewport,
}: {
  items: MapMarkerItem[];
  hoveredSlug: string | null;
  selectedSlug: string | null;
  onSelect: (item: MapMarkerItem) => void;
  locale: Locale;
  onViewport?: () => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = React.useState(map.getZoom());
  const fitted = React.useRef(false);

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => onViewport?.(),
  });

  // Fit bounds once when the first non-empty result set arrives.
  React.useEffect(() => {
    if (fitted.current || !items.length) return;
    const lats = items.map((i) => i.lat);
    const lngs = items.map((i) => i.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [48, 48], maxZoom: 14 }
    );
    fitted.current = true;
  }, [items, map]);

  const clusters = React.useMemo(() => clusterGrid(items, zoom), [items, zoom]);

  return (
    <>
      {clusters.map((cluster, i) => {
        const single = cluster.items.length === 1;
        const item = single ? cluster.items[0] : null;
        const highlighted =
          item != null && (item.slug === hoveredSlug || item.slug === selectedSlug);
        return (
          <Marker
            key={`${i}-${item?.slug ?? "cluster"}`}
            position={[cluster.lat, cluster.lng]}
            icon={markerIcon(cluster, highlighted)}
            keyboard={true}
            alt={item ? item.title : `${formatNumber(cluster.items.length)} results`}
            eventHandlers={{
              click: () => {
                if (single && item) onSelect(item);
                else map.setView([cluster.lat, cluster.lng], Math.min(18, zoom + 2));
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              {item ? (
                <span className="text-xs">
                  <span className="font-semibold">{item.title}</span>
                  {item.sublabel && <span className="block text-muted-foreground">{item.sublabel}</span>}
                </span>
              ) : (
                <span className="num text-xs">
                  {formatNumber(cluster.items.length)}{" "}
                  {cluster.items.some((c) => c.kind === "project")
                    ? t("map.marker.projectCluster", locale).replace("{n}", formatNumber(cluster.items.length))
                    : t("map.marker.cluster", locale).replace("{n}", formatNumber(cluster.items.length))}
                </span>
              )}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export default function ResultsMap({
  items,
  hoveredSlug,
  selectedSlug,
  onSelect,
  locale,
  className,
  srViewport,
  onViewport,
}: {
  items: MapMarkerItem[];
  hoveredSlug: string | null;
  selectedSlug: string | null;
  onSelect: (item: MapMarkerItem) => void;
  locale: Locale;
  className?: string;
  /** Screen-reader text describing the map contents (a11y contract). */
  srViewport?: string;
  onViewport?: () => void;
}) {
  return (
    <div className={cn("relative h-full w-full", className)}>
      <span className="sr-only" role="status">
        {srViewport ?? t("map.sr.viewport", locale).replace("{n}", String(items.length)).replace("{m}", "0").replace("{lat}", "25.1").replace("{lng}", "55.2").replace("{z}", "11")}
      </span>
      <MapContainer
        center={[25.1, 55.2]}
        zoom={11}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ background: "#efe9dd" }}
        aria-label={t("search.view.map", locale)}
      >
        <TileLayer
          url={MAP_TILE_CONFIG.url}
          maxZoom={MAP_TILE_CONFIG.maxZoom}
          attribution={MAP_TILE_CONFIG.attribution}
        />
        <MapInner
          items={items}
          hoveredSlug={hoveredSlug}
          selectedSlug={selectedSlug}
          onSelect={onSelect}
          locale={locale}
          onViewport={onViewport}
        />
      </MapContainer>
    </div>
  );
}

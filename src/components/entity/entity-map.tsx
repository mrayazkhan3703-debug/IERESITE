"use client";

/**
 * Entity mini-map (U07/U08) — lazy-loaded Leaflet map shared by the project,
 * community and developer detail pages.
 *
 * - Dynamic import (client only); scroll-wheel zoom off so the page scrolls.
 * - Markers: bronze pin (project), soft bronze dot (property) with tooltips;
 *   clicking a marker with an href SPA-navigates to its detail page.
 * - Community area: stored boundary polygon when present, otherwise an honest
 *   center-circle approximation (labeled as approximate).
 * - Tile-failure fallback keeps the section informative without the raster.
 */

import * as React from "react";
import type * as LeafletNS from "leaflet";
import { navigate } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { escapeMapHtml, MAP_TILE_CONFIG } from "@/lib/map-tiles";
import { mapMarkerIdentity } from "@/lib/map-marker-identity";

/* Brand bronze (--ie-viz-1) as a literal: Leaflet path options are SVG
 * presentation attributes and cannot host CSS var() references. */
const BRAND_BRONZE = "#8f5a2b";

export interface EntityMapMarker {
  lat: number;
  lng: number;
  label: string;
  kind: "property" | "project" | "community";
  href?: string;
  sublabel?: string;
}

export function EntityMap({
  center,
  zoom = 13,
  markers,
  area,
  boundary,
  areaLabel,
  locale = "en",
  className,
  heightClass = "h-72 sm:h-80",
}: {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: EntityMapMarker[];
  area?: { lat: number; lng: number; radiusMeters: number | null } | null;
  boundary?: unknown;
  areaLabel?: string;
  locale?: Locale;
  className?: string;
  heightClass?: string;
}) {
  const mapElRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<LeafletNS.Map | null>(null);
  const layerRef = React.useRef<LeafletNS.Layer[]>([]);
  const [mapReady, setMapReady] = React.useState(false);
  const [tilesFailed, setTilesFailed] = React.useState(false);

  const markersKey = React.useMemo(() => mapMarkerIdentity(markers), [markers]);

  /* Base map — created once per center change */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css").catch(() => {});
      if (cancelled || !mapElRef.current || mapRef.current) return;

      const map = L.map(mapElRef.current, {
        center: [center.lat, center.lng],
        zoom,
        scrollWheelZoom: false,
      });
      const tiles = L.tileLayer(MAP_TILE_CONFIG.url, {
        maxZoom: MAP_TILE_CONFIG.maxZoom,
        attribution: MAP_TILE_CONFIG.attribution,
      });
      tiles.on("tileerror", () => setTilesFailed(true));
      tiles.addTo(map);
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = [];
      setMapReady(false);
    };
  }, [center.lat, center.lng, zoom]);

  /* Markers + area layer */
  React.useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    let added: LeafletNS.Layer[] = [];
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (cancelled || !map) return;

      /* Clear previous dynamic layers */
      for (const l of layerRef.current) map.removeLayer(l);
      layerRef.current = [];
      added = [];

      /* Area: boundary polygon when stored, else circle approximation */
      const geo = boundary as { type?: string } | null | undefined;
      if (geo && (geo.type === "Polygon" || geo.type === "MultiPolygon" || geo.type === "FeatureCollection")) {
        try {
          const gl = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
            style: { color: BRAND_BRONZE, weight: 2, fillOpacity: 0.08, dashArray: "4 6" },
          }).addTo(map);
          gl.bindTooltip(`${escapeMapHtml(areaLabel ?? "")} — approximate boundary`.trim(), { direction: "top" });
          added.push(gl);
        } catch {
          /* malformed boundary — fall through to the circle approximation */
        }
      }
      if (added.length === 0 && area && area.lat && area.lng) {
        const radius = area.radiusMeters && area.radiusMeters > 0 ? area.radiusMeters : 1500;
        const circle = L.circle([area.lat, area.lng], {
          radius,
          color: BRAND_BRONZE,
          weight: 2,
          fillOpacity: 0.06,
          dashArray: "4 6",
        }).addTo(map);
        circle.bindTooltip(`${escapeMapHtml(areaLabel ?? "")} — approximate area`.trim(), { direction: "top" });
        added.push(circle);
      }

      /* Markers */
      const bounds: LeafletNS.LatLng[] = [];
      for (const m of markers) {
        const el = document.createElement("div");
        if (m.kind === "project") {
          el.className = "flex items-center justify-center rounded-full border-2 border-white bg-brand px-2.5 py-1.5 shadow-lg";
          const pin = document.createElement("div");
          pin.className = "h-2.5 w-2.5 rounded-full bg-white";
          el.appendChild(pin);
        } else {
          el.className = "flex items-center justify-center rounded-full border border-white/80 bg-brand-soft px-2 py-1.5 shadow";
          const pin = document.createElement("div");
          pin.className = "h-2 w-2 rounded-full bg-brand";
          el.appendChild(pin);
        }
        const marker = L.marker([m.lat, m.lng], {
          icon: L.divIcon({ html: el.outerHTML, className: "", iconSize: [24, 24], iconAnchor: [12, 12] }),
          keyboard: true,
          alt: m.label,
        }).addTo(map);
        added.push(marker);
        marker.bindTooltip(m.sublabel ? `<strong>${escapeMapHtml(m.label)}</strong><br/><span>${escapeMapHtml(m.sublabel)}</span>` : escapeMapHtml(m.label), {
          direction: "top",
          offset: [0, -12],
        });
        if (m.href) {
          marker.on("click", () => {
            const path = m.href!.split("?")[0];
            navigate(path);
          });
        }
        bounds.push(L.latLng(m.lat, m.lng));
      }

      layerRef.current = added;
      const fit = [...bounds, L.latLng(center.lat, center.lng)];
      if (fit.length > 1) {
        map.fitBounds(L.latLngBounds(fit).pad(0.25));
      }
    })();
    return () => {
      cancelled = true;
      const map = mapRef.current;
      if (map) for (const l of added) map.removeLayer(l);
    };
  }, [mapReady, markersKey, boundary, area?.lat, area?.lng, area?.radiusMeters, areaLabel, center.lat, center.lng]);

  return (
    <div className={cn("relative w-full overflow-hidden bg-sand", heightClass, className)}>
      <div
        ref={mapElRef}
        className="h-full w-full"
        role="application"
        aria-label={t("entity.map.aria", locale)}
      />
      {!mapReady && !tilesFailed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t("entity.map.loading", locale)}
        </div>
      )}
      {tilesFailed && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-sand/95 p-6 text-center">
          <div className="max-w-xs">
            <MapPinned className="mx-auto mb-2 h-8 w-8 text-brand" aria-hidden />
            <p className="text-sm font-semibold">{t("entity.map.tilesTitle", locale)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("entity.map.tilesBody", locale)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Atlas 2D mode (U17 — V2 §29.2/§28 "2D for analysis").
 *
 * Leaflet community-level analytical map (lazy `import("leaflet")` inside the
 * mount effect — the established repo pattern; only the Three.js scenes need
 * React.lazy chunk splitting):
 *  - community circle markers sized by the selected metric (normalized),
 *    tooltip = name + formatted value + state label;
 *  - Projects layer: sienna point markers with name tooltips;
 *  - click → selection (community or project) without losing map state;
 *  - sr-only description + graceful tile-failure notice.
 */

import * as React from "react";
import type * as LeafletNS from "leaflet";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import {
  formatAtlasMetricValue,
  metricDefinition,
  type AtlasCommunity,
  type AtlasMetricKey,
  type AtlasProject,
} from "@/components/atlas/atlas-data";
import { MARKER_BRONZE_HINT } from "@/components/atlas/atlas-shared";
import { MapPin } from "lucide-react";
import { escapeMapHtml, MAP_TILE_CONFIG } from "@/lib/map-tiles";

export interface Atlas2DMapProps {
  communities: AtlasCommunity[];
  projects: AtlasProject[];
  metricKey: AtlasMetricKey;
  layers: { communities: boolean; projects: boolean };
  selectedCommunity: string | null;
  onSelectCommunity: (slug: string | null) => void;
  onSelectProject: (slug: string) => void;
  /** Set to a community slug to fly the map to it (locate control, §29.4). */
  flyTo?: string | null;
  locale: Locale;
}

const DUBAI_CENTER: [number, number] = [25.12, 55.2];
const DEFAULT_ZOOM = 11;

export function Atlas2DMap({
  communities,
  projects,
  metricKey,
  layers,
  selectedCommunity,
  onSelectCommunity,
  onSelectProject,
  flyTo = null,
  locale,
}: Atlas2DMapProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<LeafletNS.Map | null>(null);
  const communityLayerRef = React.useRef<LeafletNS.LayerGroup | null>(null);
  const projectLayerRef = React.useRef<LeafletNS.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = React.useState(false);

  /* Base map — created once. */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css").catch(() => {});
      if (cancelled || !hostRef.current || mapRef.current) return;
      const map = L.map(hostRef.current, { center: DUBAI_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true, scrollWheelZoom: true });
      const tiles = L.tileLayer(MAP_TILE_CONFIG.url, {
        maxZoom: MAP_TILE_CONFIG.maxZoom,
        attribution: MAP_TILE_CONFIG.attribution,
      });
      tiles.on("tileerror", () => setTilesFailed(true));
      tiles.addTo(map);
      mapRef.current = map;
      communityLayerRef.current = L.layerGroup().addTo(map);
      projectLayerRef.current = L.layerGroup();
      setTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      communityLayerRef.current = null;
      projectLayerRef.current = null;
    };
  }, []);

  const [tick, setTick] = React.useState(0);

  /* Community markers — value-sized circles (2D analytical layer). */
  React.useEffect(() => {
    const map = mapRef.current;
    const group = communityLayerRef.current;
    if (!map || !group || tick === 0) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || mapRef.current !== map || communityLayerRef.current !== group) return;
      group.clearLayers();
      if (!layers.communities) return;

      const values = communities
        .map((c) => c.metrics[metricKey]?.value ?? null)
        .filter((v): v is number => v !== null);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;

      for (const c of communities) {
        const metric = c.metrics[metricKey];
        const norm = metric && max > min ? (metric.value - min) / (max - min) : 0.5;
        const radius = 900 + norm * 2600;
        const isSelected = selectedCommunity === c.slug;
        const stateLabel = metric ? metric.state.replace(/_/g, " ").toLowerCase() : "";
        const circle = L.circle([c.lat, c.lng], {
          radius,
          color: isSelected ? "#33312d" : MARKER_BRONZE_HINT,
          weight: isSelected ? 2.5 : 1.5,
          opacity: 0.85,
          fillColor: MARKER_BRONZE_HINT,
          fillOpacity: 0.28,
        });
        circle.bindTooltip(
          `<b>${escapeMapHtml(c.name)}</b><br/>${
            metric
              ? `${formatAtlasMetricValue(metricKey, metric.value)} — ${stateLabel}`
              : t("map.layers.unavailable", locale)
          }`,
          { direction: "top" }
        );
        circle.on("click", () => onSelectCommunity(c.slug));
        circle.addTo(group);
      }
    })();
    return () => { cancelled = true; };
  }, [communities, metricKey, layers.communities, selectedCommunity, locale, onSelectCommunity, tick]);

  /* Project markers — real coordinates, sienna points. */
  React.useEffect(() => {
    const map = mapRef.current;
    const group = projectLayerRef.current;
    if (!map || !group || tick === 0) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || mapRef.current !== map || projectLayerRef.current !== group) return;
      group.clearLayers();
      if (!layers.projects) {
        if (map.hasLayer(group)) map.removeLayer(group);
        return;
      }
      if (!map.hasLayer(group)) map.addLayer(group);
      for (const p of projects) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color: "#a2673a",
          weight: 2,
          fillColor: "#d0a568",
          fillOpacity: 0.9,
        });
        marker.bindTooltip(`<b>${escapeMapHtml(p.name)}</b><br/>${escapeMapHtml(p.communityName)} · ${escapeMapHtml(p.developerName)}`, { direction: "top" });
        marker.on("click", () => onSelectProject(p.slug));
        marker.addTo(group);
      }
    })();
    return () => { cancelled = true; };
  }, [projects, layers.projects, onSelectProject, tick]);

  /* Attach/detach the community layer group. */
  React.useEffect(() => {
    const map = mapRef.current;
    const group = communityLayerRef.current;
    if (!map || !group || tick === 0) return;
    if (layers.communities && !map.hasLayer(group)) map.addLayer(group);
    if (!layers.communities && map.hasLayer(group)) map.removeLayer(group);
  }, [layers.communities, tick]);

  /* flyTo — locate-community control (§29.4). */
  React.useEffect(() => {
    if (!flyTo) return;
    const map = mapRef.current;
    const community = communities.find((c) => c.slug === flyTo);
    if (!map || !community) return;
    map.flyTo([community.lat, community.lng], 13, { duration: 0.8 });
  }, [flyTo, communities]);

  const metricLabel = metricDefinition(metricKey)?.i18nKey
    ? t(metricDefinition(metricKey)!.i18nKey, locale)
    : metricKey;
  const visibleCommunities = layers.communities
    ? communities.filter((c) => c.metrics[metricKey]).length
    : 0;

  return (
    /* §16.1/§18 — absolute inset-0 (NOT h-full): the viewport host is a flex
       item whose height comes from flex sizing + min-height, which is NOT a
       definite height for percentage resolution below lg (column flex with
       flex-basis 0% — the map silently collapsed to 0px at mobile widths).
       Absolute positioning against the `relative` viewport resolves via the
       containing-block geometry instead — works in both orientations. */
    <div className="absolute inset-0">
      <div
        ref={hostRef}
        className="h-full w-full"
        role="img"
        aria-label={t("atlas.sr.scene", locale)}
      />
      <span className="sr-only">
        {t("atlas.sr.scene", locale)} — {metricLabel}:{" "}
        {communities
          .map((c) => `${c.name} ${c.metrics[metricKey] ? formatAtlasMetricValue(metricKey, c.metrics[metricKey]!.value) : t("map.layers.unavailable", locale)}`)
          .join("; ")}
        . {formatNumber(projects.length)} {t("atlas.project.marker", locale)}.
      </span>
      {tilesFailed && (
        <div className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-lg border border-warning/40 bg-card px-3 py-2 text-xs text-muted-foreground shadow-md">
          <MapPin className="h-3.5 w-3.5 text-warning" aria-hidden />
          {t("map.tiles.title", locale)} — {formatNumber(visibleCommunities)} {t("atlas.layers.communities", locale)}
        </div>
      )}
    </div>
  );
}

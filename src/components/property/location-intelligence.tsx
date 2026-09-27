"use client";

/**
 * Location intelligence (V2 §14.10) — interactive map section replacing the
 * plain nearby-community list.
 *
 * - Lazy-loaded Leaflet (dynamic import, client only) with the property marker,
 *   an approximate community area (center circle at the community radius, or the
 *   stored boundary polygon when present) and graceful tile-failure fallback.
 * - POI category chips (Metro / Schools / Hospitals / Malls) render ONLY from
 *   actual community POI data — categories without records are omitted, never
 *   fabricated. Selecting a chip reveals the underlying named places.
 * - Straight-line distance matrix to nearby communities with the explicit
 *   methodology note "straight-line distance; driving may differ".
 */

import * as React from "react";
import { escapeMapHtml, MAP_TILE_CONFIG } from "@/lib/map-tiles";
import type * as LeafletNS from "leaflet";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import { MapPin, Train, GraduationCap, HeartPulse, ShoppingBag, MapPinned, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommunityDetailLite } from "./detail-shared";

/* Brand bronze (--ie-viz-1), resolved as a literal: Leaflet pathOptions are SVG
 * presentation attributes and cannot host CSS var() references (same approach as
 * the hero mini-map). */
const BRAND_BRONZE = "#8f5a2b";

interface PoiCategory {
  key: "metro" | "schools" | "hospitals" | "malls";
  label: string;
  icon: typeof Train;
  items: string[];
}

export function LocationIntelligence({
  lat,
  lng,
  communityName,
  communitySlug,
  nearby,
  locale = "en",
}: {
  lat: number;
  lng: number;
  communityName: string;
  communitySlug: string;
  nearby: { name: string; slug: string; distanceKm: number }[];
  locale?: Locale;
}) {
  const mapElRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<LeafletNS.Map | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [tilesFailed, setTilesFailed] = React.useState(false);
  const [community, setCommunity] = React.useState<CommunityDetailLite | null>(null);
  const [activeChip, setActiveChip] = React.useState<PoiCategory["key"] | null>(null);

  /* Community POI data (only real records become chips) */
  React.useEffect(() => {
    let cancelled = false;
    api
      .get<CommunityDetailLite>(`/api/communities/${encodeURIComponent(communitySlug)}`)
      .then((c) => !cancelled && setCommunity(c))
      .catch(() => !cancelled && setCommunity(null));
    return () => {
      cancelled = true;
    };
  }, [communitySlug]);

  const poiCategories = React.useMemo<PoiCategory[]>(() => {
    if (!community) return [];
    const cats: PoiCategory[] = [];
    const metro = (community.transport ?? []).filter((tr) => /metro|tram|rail/i.test(tr.type));
    if (metro.length > 0) {
      cats.push({
        key: "metro",
        label: t("property.location.metro", locale),
        icon: Train,
        items: metro.map((m) => `${m.name}${m.distance ? ` (${m.distance})` : ""}`),
      });
    }
    if ((community.schools ?? []).length > 0) {
      cats.push({
        key: "schools",
        label: t("property.location.schools", locale),
        icon: GraduationCap,
        items: community.schools.map((s) => (s.rating ? `${s.name} (${s.rating})` : s.name)),
      });
    }
    if ((community.healthcare ?? []).length > 0) {
      cats.push({
        key: "hospitals",
        label: t("property.location.hospitals", locale),
        icon: HeartPulse,
        items: community.healthcare.map((h) => h.name),
      });
    }
    if ((community.retail ?? []).length > 0) {
      cats.push({
        key: "malls",
        label: t("property.location.malls", locale),
        icon: ShoppingBag,
        items: community.retail.map((r) => r.name),
      });
    }
    return cats;
  }, [community, locale]);

  /* Lazy Leaflet map — property marker + approximate community area */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css").catch(() => {});
      if (cancelled || !mapElRef.current || mapRef.current) return;

      const map = L.map(mapElRef.current, {
        center: [lat, lng],
        zoom: 13,
        scrollWheelZoom: false, // page scroll priority; pinch/± still available
      });
      const tiles = L.tileLayer(MAP_TILE_CONFIG.url, {
        maxZoom: MAP_TILE_CONFIG.maxZoom,
        attribution: MAP_TILE_CONFIG.attribution,
      });
      tiles.on("tileerror", () => setTilesFailed(true));
      tiles.addTo(map);
      mapRef.current = map;

      // Property marker — bronze pin with hover label
      const markerEl = document.createElement("div");
      markerEl.className =
        "flex items-center justify-center rounded-full border-2 border-white bg-brand px-2.5 py-1.5 shadow-lg";
      const pin = document.createElement("div");
      pin.className = "h-2.5 w-2.5 rounded-full bg-white";
      markerEl.appendChild(pin);
      L.marker([lat, lng], {
        icon: L.divIcon({ html: markerEl.outerHTML, className: "", iconSize: [26, 26], iconAnchor: [13, 13] }),
        keyboard: true,
        alt: `${communityName} property location`,
      })
        .addTo(map)
        .bindTooltip(escapeMapHtml(communityName), { direction: "top", offset: [0, -12] });

      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, communityName]);

  /* Community area — boundary polygon when stored, center circle as approximation */
  React.useEffect(() => {
    if (!mapReady || !community) return;
    let cancelled = false;
    let layer: LeafletNS.Layer | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (cancelled || !map) return;
      const geo = community.boundary as { type?: string } | null;
      if (geo && (geo.type === "Polygon" || geo.type === "MultiPolygon" || geo.type === "FeatureCollection")) {
        try {
          const geoLayer = L.geoJSON(community.boundary as GeoJSON.GeoJsonObject, {
            style: { color: BRAND_BRONZE, weight: 2, fillOpacity: 0.08, dashArray: "4 6" },
          }).addTo(map);
          geoLayer.bindTooltip(`${escapeMapHtml(communityName)} — approximate boundary`, { direction: "top" });
          layer = geoLayer;
          map.fitBounds(geoLayer.getBounds().extend(L.latLng(lat, lng)), { padding: [24, 24] });
        } catch {
          /* malformed boundary — fall through to circle approximation */
        }
      }
      if (!layer && community.lat && community.lng) {
        const radius = community.radiusMeters && community.radiusMeters > 0 ? community.radiusMeters : 1500;
        const circle = L.circle([community.lat, community.lng], {
          radius,
          color: BRAND_BRONZE,
          weight: 2,
          fillOpacity: 0.06,
          dashArray: "4 6",
        }).addTo(map);
        circle.bindTooltip(`${escapeMapHtml(communityName)} — approximate area`, { direction: "top" });
        layer = circle;
        map.fitBounds(circle.getBounds().extend(L.latLng(lat, lng)), { padding: [24, 24] });
      }
    })();
    return () => {
      cancelled = true;
      if (layer && mapRef.current) mapRef.current.removeLayer(layer);
    };
  }, [mapReady, community, lat, lng, communityName]);

  const activeItems = activeChip ? poiCategories.find((c) => c.key === activeChip)?.items ?? [] : [];

  return (
    <section aria-labelledby="location-heading">
      <h2 id="location-heading" className="font-display text-xl font-semibold">
        {t("property.location.title", locale)}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {communityName} · <span className="num">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
        {/* Map */}
        <div className="relative h-72 w-full bg-sand sm:h-80">
          <div
            ref={mapElRef}
            className="h-full w-full"
            role="application"
            aria-label={t("property.location.mapAria", locale)}
          />
          {!mapReady && !tilesFailed && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {t("property.location.loadingMap", locale)}
            </div>
          )}
          {tilesFailed && (
            <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-sand/95 p-6 text-center">
              <div className="max-w-xs">
                <MapPinned className="mx-auto mb-2 h-8 w-8 text-brand" aria-hidden />
                <p className="text-sm font-semibold">{t("property.location.tilesUnavailable", locale)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("property.location.tilesFallback", locale)}</p>
              </div>
            </div>
          )}
        </div>

        {/* POI chips — only categories with real data */}
        {poiCategories.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border/60 bg-card p-3">
            {poiCategories.map((cat) => {
              const Icon = cat.icon;
              const active = activeChip === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveChip(active ? null : cat.key)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-ui",
                    active
                      ? "border-brand/60 bg-brand-faint text-brand-strong"
                      : "border-border/70 bg-card text-foreground hover:border-brand/40"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {cat.label}
                  <span className="num rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{formatNumber(cat.items.length)}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected POI list */}
        {activeChip && (
          <div className="border-t border-border/60 bg-secondary/40 p-3">
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {activeItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-foreground/85">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Distance matrix + methodology */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("property.location.methodology", locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("property.location.nearby", locale)}
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {nearby.map((n) => (
              <li key={n.slug}>
                <Link
                  to={`/communities/${n.slug}`}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3.5 py-2.5 text-sm transition-ui hover:border-brand/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span className="truncate">{n.name}</span>
                  </span>
                  <span className="num shrink-0 text-muted-foreground">{n.distanceKm} km</span>
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" size="sm" className="mt-3 gap-1.5 print:hidden">
            <Link to="/properties/map" query={{ community: communitySlug }}>
              <MapPinned className="h-4 w-4" aria-hidden /> {t("property.location.exploreMap", locale)}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

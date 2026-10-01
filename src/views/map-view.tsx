"use client";

/**
 * 2D Map Discovery V2 (U05, V2 §13) — a real map discovery product:
 *
 * - dual markers (properties + projects), grid clustering (zoom-aware)
 * - layer control panel: Properties / Projects / Communities (approx circles) /
 *   Transaction activity / Rent — layers without data stay honestly disabled
 * - marker style: pin vs price pill (formatAEDPrecise)
 * - "Search this area" only after an explicit pan (F09 — never auto-applied)
 * - viewport + layers + marker mode persisted in the URL (?z=&c=&layers=&marker=)
 * - selected property/project preview card in-map (map state preserved)
 * - desktop list ↔ map sync (click list → flyTo; marker → preview)
 * - mobile full-screen map + bottom results drawer (vaul)
 * - community jump panel, graceful tile-failure fallback, sr-only description
 */

import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { navigate, useRoute, Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { PropertyCard } from "@/components/property/property-card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FilterPanel, FILTER_KEYS, type SearchFacetsExt } from "@/components/search/filter-panel";
import type { SearchMode } from "@/components/search/mode-tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Price, LoadingState, EmptyState, UnavailableValue } from "@/components/common";
import { events } from "@/lib/analytics-tracker";
import { formatMoney, formatNumber, fromMinor } from "@/lib/money";
import { formatAEDPrecise } from "@/lib/format-precise";
import { localeOf, t } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ListingCardDTO } from "@/lib/types";
import { MapPin, Search, List as ListIcon, Loader2, Crosshair, Layers as LayersIcon, ChevronDown, MapPinned, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_COLORS } from "@/lib/chart-theme";
import { escapeMapHtml, MAP_TILE_CONFIG } from "@/lib/map-tiles";
import { mapViewport, mapBounds } from "@/lib/map-state";
import { PublicImage } from "@/components/public-image";
import { propertyPinIcon } from "@/lib/leaflet-icons";

/* Resolved chart-theme tokens (HTML/SVG presentation values cannot host var()). */
const MARKER_BRONZE = "#8f5a2b"; // --ie-viz-1 / --brand
const PROJECT_SIENNA = CHART_COLORS[1]; // --ie-viz-2
const ACTIVITY_GOLD = CHART_COLORS[2]; // --ie-viz-3

interface MapCommunity {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

interface MapProject {
  id: string;
  slug: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  handoverDate: string | null;
  completionPercent: number | null;
  startingPrice: { minor: string; currency: string } | null;
  totalUnits: number | null;
  developer: { id: string; name: string; slug: string };
  community: { id: string; name: string; slug: string };
}

interface MapPropertyCluster {
  lat: number;
  lng: number;
  count: number;
  listingId: string | null;
  slug: string | null;
  title: string | null;
  priceMinor: string | null;
  currency: string | null;
}

interface CommunityMetricLayer {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  transactionCount?: number;
  rent1Br?: number;
  avgPsqft?: number;
}

const LAYER_KEYS = ["props", "projects", "communities", "activity", "rent"] as const;
type LayerKey = (typeof LAYER_KEYS)[number];

const LAYER_LABEL_KEY: Record<LayerKey, string> = {
  props: "map.layers.properties",
  projects: "map.layers.projects",
  communities: "map.layers.communities",
  activity: "map.layers.activity",
  rent: "map.layers.rent",
};


/* Viewport keys live in the URL but must not refetch results on change. */
const VIEWPORT_KEYS = new Set(["z", "c", "layers", "marker", "selected", "selectedKind"]);

/* Grid clustering — cell size halves per zoom level, bounded. */
interface Cluster {
  lat: number;
  lng: number;
  items: ListingCardDTO[];
}

function clusterGrid(items: ListingCardDTO[], zoom: number): Cluster[] {
  const cell = Math.min(0.3, Math.max(0.003, 0.3 / Math.pow(2, Math.max(0, zoom - 8))));
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

function handoverQuarterLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export default function MapView() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  usePageMeta({
    title: `${t("map.title", locale)} — Dubai Property`,
    description: "Explore Dubai property and projects on an interactive map — clustered listings, layers, search-this-area and community boundaries.",
    noindex: true, // internal search state (F10)
  });

  /* ------------------------------ URL state -------------------------- */
  const layers = React.useMemo(() => {
    const raw = (loc.query.layers ?? "props").split(",").filter((v) => (LAYER_KEYS as readonly string[]).includes(v));
    return new Set<LayerKey>(raw.length ? (raw as LayerKey[]) : ["props"]);
  }, [loc.query.layers]);
  const markerMode: "pin" | "price" = loc.query.marker === "price" ? "price" : "pin";

  const initialCenter = React.useMemo<[number, number]>(() => mapViewport(loc.query).center, []);
  const initialZoom = React.useMemo(() => mapViewport(loc.query).zoom, []);

  const setLayers = (key: LayerKey, enabled: boolean) => {
    const next = new Set(layers);
    if (enabled) next.add(key);
    else next.delete(key);
    if (next.size === 0) next.add("props"); // never all-off
    events.mapLayerChanged(key, enabled);
    navigate(
      "/properties/map",
      { ...loc.query, layers: [...next].join(",") },
      { replace: true }
    );
  };

  const setMarkerMode = (m: "pin" | "price") => {
    navigate("/properties/map", { ...loc.query, marker: m === "price" ? "price" : undefined }, { replace: true });
  };

  /* Filter mode — labels only; the mode param flows through the query into
     /api/map exactly as it does on /properties (RENT vs SALE inventory). */
  const mode: SearchMode =
    loc.query.mode === "rent" ? "rent" : loc.query.mode === "offplan" ? "offplan" : loc.query.mode === "projects" ? "projects" : "buy";

  /* Filter sheet (§16.1) — writes the same URL params the map fetch reads;
     viewport keys (z/c/layers/marker) are always preserved. */
  const setFilterParam = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...loc.query };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") delete next[k];
      else next[k] = v;
    }
    delete next.page;
    delete next.selected;
    events.filter(patch);
    navigate("/properties/map", next, { replace: true });
  };

  const clearAllFilters = () => {
    const viewportOnly: Record<string, string> = {};
    for (const k of VIEWPORT_KEYS) if (loc.query[k]) viewportOnly[k] = loc.query[k];
    if (loc.query.bbox) viewportOnly.bbox = loc.query.bbox;
    delete viewportOnly.selected;
    navigate("/properties/map", viewportOnly, { replace: true });
  };

  /* ------------------------------ data ------------------------------- */
  const [results, setResults] = React.useState<ListingCardDTO[] | null>(null);
  const [propertyClusters, setPropertyClusters] = React.useState<MapPropertyCluster[] | null>(null);
  const [mapTotal, setMapTotal] = React.useState(0);
  const [projects, setProjects] = React.useState<MapProject[]>([]);
  const [communities, setCommunities] = React.useState<MapCommunity[]>([]);
  const [metrics, setMetrics] = React.useState<CommunityMetricLayer[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mapError, setMapError] = React.useState("");
  const [degraded, setDegraded] = React.useState(false);
  const [pageOnlyClusters, setPageOnlyClusters] = React.useState(false);
  const [hoveredSlug, setHoveredSlug] = React.useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = React.useState(false);
  const [searchingArea, setSearchingArea] = React.useState(false);
  const [hasMoved, setHasMoved] = React.useState(false);
  const [zoomState, setZoomState] = React.useState(initialZoom);
  const [selected, setSelected] = React.useState<{ kind: "property" | "project"; listing?: ListingCardDTO; project?: MapProject } | null>(null);
  const [listOpen, setListOpen] = React.useState(false);
  const [layersPanelOpen, setLayersPanelOpen] = React.useState(true);
  const [layersSheetOpen, setLayersSheetOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  /* undefined = not fetched yet · null = fetch failed (panel works without
     facet counts) · object = fetched. One request per sheet open. */
  const [facets, setFacets] = React.useState<SearchFacetsExt | null | undefined>(undefined);
  const isMobile = useIsMobile();

  const mapRef = React.useRef<L.Map | null>(null);
  const LRef = React.useRef<typeof import("leaflet") | null>(null);
  const propsLayerRef = React.useRef<L.LayerGroup | null>(null);
  const projectsLayerRef = React.useRef<L.LayerGroup | null>(null);
  const communitiesLayerRef = React.useRef<L.LayerGroup | null>(null);
  const activityLayerRef = React.useRef<L.LayerGroup | null>(null);
  const rentLayerRef = React.useRef<L.LayerGroup | null>(null);
  const mapElRef = React.useRef<HTMLDivElement>(null);
  const bboxRef = React.useRef<[number, number, number, number] | null>(null);
  const searchedBoundsRef = React.useRef(mapBounds(loc.query.bbox));
  const restoringViewport = React.useRef(false);
  const urlTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Latest query for the (once-registered) map moveend handler — a plain
     closure over `loc.query` would go stale after layer/marker params change
     via replace-navigation and the next pan would wipe them from the URL. */
  const queryRef = React.useRef(loc.query);
  React.useEffect(() => {
    queryRef.current = loc.query;
  }, [loc.query]);

  /* Filter query (viewport keys stripped) — the fetch dependency. */
  const filterQueryStr = React.useMemo(() => {
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(loc.query)) if (!VIEWPORT_KEYS.has(k)) filtered[k] = v;
    return JSON.stringify(filtered);
  }, [loc.query]);

  /* ------------------------------ init map --------------------------- */
  React.useEffect(() => {
    events.mapOpened("map-view");
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css").catch(() => {});
      if (cancelled || !mapElRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(mapElRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: false,
        scrollWheelZoom: true,
      });
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const tiles = L.tileLayer(MAP_TILE_CONFIG.url, {
        maxZoom: MAP_TILE_CONFIG.maxZoom,
        attribution: MAP_TILE_CONFIG.attribution,
      });
      tiles.on("tileerror", () => { if (!cancelled) setTilesFailed(true); });
      tiles.addTo(map);
      mapRef.current = map;
      propsLayerRef.current = L.layerGroup().addTo(map);
      projectsLayerRef.current = L.layerGroup();
      communitiesLayerRef.current = L.layerGroup();
      activityLayerRef.current = L.layerGroup();
      rentLayerRef.current = L.layerGroup();

      map.on("moveend zoomend", () => {
        const b = map.getBounds();
        bboxRef.current = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        if (restoringViewport.current) { setZoomState(map.getZoom()); return; }
        /* F09 — panning NEVER auto-applies a new search: the viewport is
           recorded (URL + bboxRef) and the persistent "Search this area"
           button offers the explicit refetch. (bboxTick only advances on the
           initial load — a pan must not refetch; filters refetch via
           filterQueryStr.) */
        setHasMoved(true);
        setZoomState(map.getZoom());
        // Debounced replace-navigation: viewport state is shareable, not history spam.
        if (urlTimer.current) clearTimeout(urlTimer.current);
        urlTimer.current = setTimeout(() => {
          const c = map.getCenter();
          navigate(
            "/properties/map",
            {
              ...queryRef.current,
              z: String(map.getZoom()),
              c: `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`,
            },
            { replace: true }
          );
        }, 600);
      });
      const b = map.getBounds();
      bboxRef.current = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      if (!searchedBoundsRef.current) searchedBoundsRef.current = bboxRef.current;
      if (!queryRef.current.bbox) navigate("/properties/map", { ...queryRef.current, bbox: searchedBoundsRef.current.join(","), c: initialCenter.join(","), z: String(initialZoom) }, { replace: true });
      setBboxTick((n) => n + 1);
    })().catch(() => {
      if (!cancelled) { setTilesFailed(true); setBboxTick((n) => n + 1); }
    });
    return () => {
      cancelled = true;
      if (urlTimer.current) clearTimeout(urlTimer.current);
      urlTimer.current = null;
      const map = mapRef.current;
      mapRef.current = null;
      LRef.current = null;
      propsLayerRef.current = null;
      projectsLayerRef.current = null;
      communitiesLayerRef.current = null;
      activityLayerRef.current = null;
      rentLayerRef.current = null;
      bboxRef.current = null;
      if (map) { map.off(); map.remove(); }
    };
  }, []);

  /* ------------------------------ fetch ------------------------------ */
  const [bboxTick, setBboxTick] = React.useState(0);
  const fetchKey = `${filterQueryStr}|${bboxTick}`;
  React.useEffect(() => {
    if (!bboxTick) return;
    const abort = new AbortController();
    const bbox = mapBounds(loc.query.bbox) ?? searchedBoundsRef.current;
    const params = new URLSearchParams({ ...loc.query, pageSize: "48" });
    VIEWPORT_KEYS.forEach((k) => params.delete(k));
    if (bbox) params.set("bbox", bbox.join(","));
    params.set("zoom", String(zoomState));
    setLoading(true);
    setMapError("");
    api
      .get<{ results: ListingCardDTO[]; total: number; clusters?: MapPropertyCluster[]; communities: MapCommunity[]; projects?: MapProject[]; degraded?: boolean; clusterCoverage?: string }>("/api/map?" + params.toString(), abort.signal)
      .then((res) => {
        if (abort.signal.aborted) return;
        setResults(res.results);
        setPropertyClusters(res.clusters ?? null);
        setMapTotal(res.total ?? res.results.length);
        setCommunities(res.communities);
        setProjects(res.projects ?? []);
        setDegraded(Boolean(res.degraded));
        setPageOnlyClusters(res.clusterCoverage === "PAGE_ONLY" && res.total > res.results.length);
      })
      .catch(() => {
        if (!abort.signal.aborted) setMapError(t("map.error.results", locale));
      })
      .finally(() => {
        if (abort.signal.aborted) return;
        setLoading(false);
        setSearchingArea(false);
        setHasMoved(false);
      });
    return () => abort.abort();
  }, [fetchKey]);

  // Query-only history traversal restores the viewport without re-searching a
  // panned area. The applied bounding box remains an independent URL field.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !bboxTick) return;
    const viewport = mapViewport(loc.query), center = map.getCenter();
    if (Math.abs(center.lat - viewport.center[0]) < 0.0002 && Math.abs(center.lng - viewport.center[1]) < 0.0002 && map.getZoom() === viewport.zoom) return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    restoringViewport.current = true;
    map.setView(viewport.center, viewport.zoom, { animate: false });
    restoringViewport.current = false;
  }, [loc.query.c, loc.query.z]);

  React.useEffect(() => {
    const slug = loc.query.selected;
    if (!slug) { setSelected(null); return; }
    const listing = results?.find((r) => r.slug === slug);
    const project = projects.find((p) => p.slug === slug);
    if (listing) setSelected({ kind: "property", listing });
    else if (project) setSelected({ kind: "project", project });
    else {
      const abort = new AbortController();
      api.get<{ listing?: ListingCardDTO; project?: MapProject }>(`/api/map/selection?slug=${encodeURIComponent(slug)}&kind=${loc.query.selectedKind === "project" ? "project" : "property"}`, abort.signal).then((res) => { if (!abort.signal.aborted) setSelected(res.project ? { kind: "project", project: res.project } : res.listing ? { kind: "property", listing: res.listing } : null); }).catch(() => { if (!abort.signal.aborted) setSelected(null); });
      return () => abort.abort();
    }
  }, [loc.query.selected, loc.query.selectedKind, results, projects]);

  const selectResult = (item: { slug: string; id?: string; kind?: "property" | "project" }) => {
    navigate("/properties/map", { ...queryRef.current, selected: item.slug, selectedKind: item.kind === "project" ? "project" : undefined }, { replace: true });
    if (item.id) document.getElementById(`map-result-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  /* Facets for the filter sheet — one lightweight /api/search request per
     sheet open (pageSize=1, facets included) with the current filters. */
  React.useEffect(() => {
    if (!filtersOpen) return;
    const params = new URLSearchParams({ ...loc.query, page: "1", pageSize: "1" });
    VIEWPORT_KEYS.forEach((k) => params.delete(k));
    let cancelled = false;
    api
      .get<{ facets?: SearchFacetsExt }>("/api/search?" + params.toString())
      .then((res) => {
        if (!cancelled) setFacets(res.facets ?? null);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filtersOpen, filterQueryStr]);

  /* Community metrics for the activity/rent layers (latest per community).
     Coordinates are joined at render time — communities arrive from the map
     fetch after this one-shot metrics call. */
  React.useEffect(() => {
    api
      .get<{
        metrics: {
          community?: { slug: string; name: string } | null;
          metricKey: string;
          valueNumeric: number;
        }[];
      }>("/api/market/metrics?latest=1")
      .then((r) => {
        const byslug = new Map<string, CommunityMetricLayer>();
        for (const m of r.metrics) {
          const slug = m.community?.slug;
          if (!slug) continue;
          const entry = byslug.get(slug) ?? {
            slug,
            name: m.community?.name ?? slug,
            lat: 0,
            lng: 0,
            radiusMeters: 2500,
          };
          if (m.metricKey === "TRANSACTION_COUNT") entry.transactionCount = m.valueNumeric;
          else if (m.metricKey === "AVG_RENT_1BR") entry.rent1Br = m.valueNumeric;
          else if (m.metricKey === "AVG_PRICE_PER_SQFT") entry.avgPsqft = m.valueNumeric;
          byslug.set(slug, entry);
        }
        setMetrics([...byslug.values()]);
      })
      .catch(() => setMetrics([]));
  }, []);

  /* Join metric rows with community coordinates (arrive asynchronously). */
  const metricLayers = React.useMemo(() => {
    if (!metrics) return null;
    const coords = new Map(communities.map((c) => [c.slug, c]));
    const joined = metrics
      .map((m) => {
        const c = coords.get(m.slug);
        return c ? { ...m, lat: c.lat, lng: c.lng, radiusMeters: c.radiusMeters } : null;
      })
      .filter((m): m is CommunityMetricLayer => m !== null);
    return joined.length ? joined : null;
  }, [metrics, communities]);

  /* ------------------------------ marker rendering ------------------ */
  /* Property markers: clustered pills (count) or pin/price pills per mode. */
  React.useEffect(() => {
    const L = LRef.current;
    const layer = propsLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map || !results) return;
    layer.clearLayers();
    if (!layers.has("props")) return;

    const clusters = propertyClusters ?? clusterGrid(results, zoomState).map((cluster) => ({
      lat: cluster.lat,
      lng: cluster.lng,
      count: cluster.items.length,
      listingId: cluster.items.length === 1 ? cluster.items[0].id : null,
      slug: cluster.items.length === 1 ? cluster.items[0].slug : null,
      title: cluster.items.length === 1 ? cluster.items[0].title : null,
      priceMinor: cluster.items.length === 1 ? cluster.items[0].price.minor : null,
      currency: cluster.items.length === 1 ? cluster.items[0].price.currency : null,
    }));
    for (const cluster of clusters) {
      const single = cluster.count === 1;
      const item = single ? results.find((result) => result.id === cluster.listingId || result.slug === cluster.slug) ?? null : null;
      const isSelected = item != null && ((selected?.kind === "property" && selected.listing?.slug === item.slug) || hoveredSlug === item.slug);

      let icon: L.DivIcon | L.Icon;
      let priceLabel: string | null = null;
      if (single && markerMode === "pin" && !isSelected) {
        icon = propertyPinIcon(L);
      } else if (single) {
        const minor = item?.price.minor ?? cluster.priceMinor;
        priceLabel = minor ? formatAEDPrecise(fromMinor(minor)) : "◦";
        const cls = cn(
          "num flex items-center justify-center whitespace-nowrap rounded-full border-2 px-2.5 py-1 text-xs font-semibold shadow-md transition-transform",
          isSelected ? "ie-marker-pulse scale-125 border-ink bg-ink text-white" : "border-white bg-card text-brand-strong"
        );
        const style = isSelected ? "" : "";
        icon = L.divIcon({ html: `<div class="${cls}" style="${style}">${priceLabel}</div>`, className: "", iconSize: [0, 0] });
      } else {
        icon = L.divIcon({
          html: `<div class="num flex items-center justify-center rounded-full border-2 border-white px-2.5 py-1 text-sm font-semibold shadow-md" style="background-color:${MARKER_BRONZE};color:#fff;">${formatNumber(cluster.count)}</div>`,
          className: "",
          iconSize: [0, 0],
        });
      }

      const marker = L.marker([cluster.lat, cluster.lng], { icon, keyboard: true });
      marker.on("add", () => {
        const el = marker.getElement();
        el?.setAttribute("role", "button");
        el?.setAttribute(
          "aria-label",
          single
            ? `${item?.title ?? cluster.title ?? t("map.layers.properties", locale)} — ${t("map.preview.viewProperty", locale)}`
            : t("map.marker.cluster", locale).replace("{n}", formatNumber(cluster.count))
        );
      });
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        if (single) {
          if (item) selectResult(item);
          else if (cluster.slug) selectResult({ slug: cluster.slug });
        } else {
          if (map.getZoom() >= 17) { setListOpen(true); return; }
          map.setView([cluster.lat, cluster.lng], Math.min(18, map.getZoom() + 2));
          const bounds = map.getBounds();
          navigate("/properties/map", { ...queryRef.current, page: undefined, selected: undefined, bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","), z: String(map.getZoom()), c: `${cluster.lat},${cluster.lng}` }, { replace: true });
        }
      });
      marker.addTo(layer);
    }
  }, [results, propertyClusters, zoomState, markerMode, layers, selected, hoveredSlug, locale]);

  /* Project markers (distinct sienna pills, name tooltip). */
  React.useEffect(() => {
    const L = LRef.current;
    const layer = projectsLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    layer.clearLayers();
    if (!layers.has("projects")) return;

    for (const p of projects) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const isSelected = selected?.kind === "project" && selected.project?.slug === p.slug;
      const label = p.startingPrice ? formatAEDPrecise(fromMinor(p.startingPrice.minor)) : "◦";
      const cls = cn(
        "flex items-center justify-center whitespace-nowrap rounded-md border-2 px-2 py-1 text-xs font-semibold shadow-md",
        isSelected ? "ie-marker-pulse scale-125 border-ink bg-ink text-white" : "border-white text-white"
      );
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          html: `<div class="${cls}" style="background-color:${PROJECT_SIENNA};">${label}</div>`,
          className: "",
          iconSize: [0, 0],
        }),
        keyboard: true,
      });
      marker.bindTooltip(
        `<b>${escapeMapHtml(p.name)}</b><br/>${escapeMapHtml(p.community.name)} · ${escapeMapHtml(p.developer.name)}`,
        { direction: "top", offset: [0, -6] }
      );
      marker.on("add", () => {
        const el = marker.getElement();
        el?.setAttribute("role", "button");
        el?.setAttribute("aria-label", `${p.name} — ${t("map.preview.viewProject", locale)}`);
      });
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        selectResult({ ...p, kind: "project" });
      });
      marker.addTo(layer);
    }
  }, [projects, layers, selected, locale]);

  /* Community boundary circles (approximate — center + recorded radius). */
  React.useEffect(() => {
    const L = LRef.current;
    const layer = communitiesLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    layer.clearLayers();
    if (!layers.has("communities")) return;
    for (const c of communities) {
      L.circle([c.lat, c.lng], {
        radius: c.radiusMeters,
        color: MARKER_BRONZE,
        weight: 1.5,
        opacity: 0.7,
        fillColor: MARKER_BRONZE,
        fillOpacity: 0.05,
        dashArray: "4 4",
      })
        .bindTooltip(`${escapeMapHtml(c.name)} — ${escapeMapHtml(t("map.layers.approx", locale))}`, { direction: "top" })
        .addTo(layer);
    }
  }, [communities, layers, locale]);

  /* Transaction activity circles (area ∝ recorded transaction count). */
  React.useEffect(() => {
    const L = LRef.current;
    const layer = activityLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map || !metricLayers) return;
    layer.clearLayers();
    if (!layers.has("activity")) return;
    for (const m of metricLayers) {
      if (m.transactionCount == null || m.transactionCount <= 0) continue;
      const radius = 400 + Math.sqrt(m.transactionCount) * 60;
      L.circle([m.lat, m.lng], {
        radius,
        color: ACTIVITY_GOLD,
        weight: 1.5,
        opacity: 0.8,
        fillColor: ACTIVITY_GOLD,
        fillOpacity: 0.28,
      })
        .bindTooltip(
          `<b>${escapeMapHtml(m.name)}</b><br/>${formatNumber(m.transactionCount)} transactions — ${escapeMapHtml(t("map.state.illustrative", locale))}`,
          { direction: "top" }
        )
        .addTo(layer);
    }
  }, [metricLayers, layers, locale]);

  /* Rent labels (modeled avg 1BR annual rent per community). */
  React.useEffect(() => {
    const L = LRef.current;
    const layer = rentLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map || !metricLayers) return;
    layer.clearLayers();
    if (!layers.has("rent")) return;
    for (const m of metricLayers) {
      if (m.rent1Br == null) continue;
      L.marker([m.lat, m.lng], {
        icon: L.divIcon({
          html: `<div class="num whitespace-nowrap rounded-full border border-border bg-ink/85 px-2.5 py-1 text-[11px] font-semibold text-white shadow-md" style="">${escapeMapHtml(m.name)}: ${formatAEDPrecise(m.rent1Br)}/yr</div>`,
          className: "",
          iconSize: [0, 0],
        }),
        keyboard: false,
      })
        .bindTooltip(t("map.layers.rentNote", locale), { direction: "top" })
        .addTo(layer);
    }
  }, [metricLayers, layers, locale]);

  /* Attach/detach layer groups when the layer set changes. */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const toggle = (layer: L.LayerGroup | null, on: boolean) => {
      if (!layer) return;
      if (on && !map.hasLayer(layer)) map.addLayer(layer);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    };
    toggle(propsLayerRef.current, layers.has("props"));
    toggle(projectsLayerRef.current, layers.has("projects"));
    toggle(communitiesLayerRef.current, layers.has("communities"));
    toggle(activityLayerRef.current, layers.has("activity"));
    toggle(rentLayerRef.current, layers.has("rent"));
  }, [layers, results, projects, communities, metricLayers]);

  /* ------------------------------ interactions ----------------------- */
  const searchThisArea = () => {
    const bbox = bboxRef.current;
    if (!bbox) return;
    setSearchingArea(true);
    events.mapView("search_this_area");
    const center = mapRef.current?.getCenter();
    searchedBoundsRef.current = bbox;
    navigate("/properties/map", { ...queryRef.current, page: undefined, selected: undefined, bbox: bbox.join(","), z: String(zoomState), ...(center ? { c: `${center.lat.toFixed(4)},${center.lng.toFixed(4)}` } : {}) }, { replace: true });
    setBboxTick((n) => n + 1);
  };

  const flyToItem = (kind: "property" | "project", lat: number, lng: number, slug: string) => {
    mapRef.current?.flyTo([lat, lng], Math.max(mapRef.current.getZoom(), 14), { duration: 0.8 });
    const listing = kind === "property" ? results?.find((r) => r.slug === slug) : undefined;
    selectResult({ slug, id: listing?.id, kind });
  };

  const propertyList = results ?? [];
  const activeFilterCount = FILTER_KEYS.filter((k) => loc.query[k]).length;
  const resultPage = Math.max(1, Math.min(500, Number(loc.query.page) || 1));
  const resultPages = Math.max(1, Math.ceil(mapTotal / 48));
  const pagination = mapTotal > 48 && <nav className="my-3 flex items-center justify-between gap-2 text-xs" aria-label={t("map.list.pages", locale)}><Button size="sm" variant="outline" disabled={loading || resultPage <= 1} onClick={() => navigate("/properties/map", { ...loc.query, page: String(resultPage - 1) })}>{t("map.list.previous", locale)}</Button><span>{resultPage} / {resultPages}</span><Button size="sm" variant="outline" disabled={loading || resultPage >= resultPages} onClick={() => navigate("/properties/map", { ...loc.query, page: String(resultPage + 1) })}>{t("map.list.next", locale)}</Button></nav>;

  /* sr-only live description of the map for assistive tech. */
  const srViewport = t("map.sr.viewport", locale)
    .replace("{n}", formatNumber(mapTotal))
    .replace("{m}", formatNumber(projects.length))
    .replace("{lat}", initialCenter[0].toFixed(2))
    .replace("{lng}", initialCenter[1].toFixed(2))
    .replace("{z}", String(zoomState));

  const metricLayersAvailable = metricLayers !== null && metricLayers.length > 0;

  const layerButton = (key: LayerKey, disabledReason?: string, forSheet = false) => {
    const disabled = !!disabledReason;
    const on = layers.has(key) && !disabled;
    const button = (
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => setLayers(key, !on)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-xs font-medium transition-ui",
          forSheet ? "min-h-11 py-2.5 text-sm" : "py-2",
          disabled
            ? "cursor-not-allowed text-muted-foreground/50"
            : on
            ? "bg-brand-soft text-brand-strong"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        {t(LAYER_LABEL_KEY[key], locale)}
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full border", on ? "border-brand bg-brand" : "border-border bg-transparent", disabled && "border-dashed")}
        />
      </button>
    );
    return disabledReason ? (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-xs">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <div className="flex h-[calc(100dvh-122px-env(safe-area-inset-bottom))] flex-col md:h-[calc(100vh-4rem)]">
      {/* Toolbar */}
      <div className="border-b border-border/70 bg-card/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <h1 className="font-display text-lg font-semibold">{t("map.title", locale)}</h1>
            <span className="num text-muted-foreground">
              {loading ? "…" : `${formatNumber(mapTotal)} ${t("map.inView", locale)}`}
              {layers.has("projects") && projects.length > 0 && !loading && (
                <span className="ml-1.5 text-muted-foreground/70">· {formatNumber(projects.length)} {t("map.layers.projects", locale).toLowerCase()}</span>
              )}
            </span>
            <span className="sr-only" role="status">
              {srViewport}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasMoved && (
              <Button size="sm" className="h-11 gap-1.5 animate-in fade-in sm:h-8" onClick={searchThisArea} disabled={searchingArea || loading}>
                {searchingArea ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                {t("map.searchArea", locale)}
              </Button>
            )}
            {/* Filters (§16.1) — bottom sheet on mobile, side sheet on desktop;
                active-count badge keeps the state explicit. */}
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 sm:h-8"
              onClick={() => setFiltersOpen(true)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              {t("search.filters", locale)}
              {activeFilterCount > 0 && (
                <span className="num rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-strong">
                  {formatNumber(activeFilterCount)}
                </span>
              )}
            </Button>
            {/* Marker style (§13 price marker mode) */}
            <div className="hidden items-center gap-1 rounded-full border border-border bg-background p-1 sm:flex" role="group" aria-label={t("map.marker.label", locale)}>
              {([
                { v: "pin", labelKey: "map.marker.pin" },
                { v: "price", labelKey: "map.marker.price" },
              ] as const).map(({ v, labelKey }) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={markerMode === v}
                  onClick={() => setMarkerMode(v)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-ui",
                    markerMode === v ? "bg-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(labelKey, locale)}
                </button>
              ))}
            </div>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/properties" query={Object.fromEntries(Object.entries(loc.query).filter(([k]) => !VIEWPORT_KEYS.has(k)))}>
                <ListIcon className="h-4 w-4" aria-hidden /> {t("search.view.list", locale)}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {(mapError || degraded || pageOnlyClusters) && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 text-sm" role={mapError ? "alert" : "status"}><p>{mapError || (degraded ? t("map.error.degraded", locale) : t("map.error.pageOnly", locale))}</p>{mapError && <Button size="sm" variant="outline" onClick={() => setBboxTick((n) => n + 1)}>{t("map.error.retry", locale)}</Button>}</div>}

      <div className="relative flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative min-w-0 flex-1">
          <div ref={mapElRef} className="h-full w-full" role="application" aria-label={srViewport} />

          {/* Layers control panel (§13) — desktop (lg+); logical start positioning mirrors in RTL */}
          <div className="absolute start-3 top-3 z-[500] hidden w-52 lg:block">
            <Collapsible open={layersPanelOpen} onOpenChange={setLayersPanelOpen}>
              <div className="overflow-hidden rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <LayersIcon className="h-4 w-4 text-brand" aria-hidden /> {t("map.layers.title", locale)}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", layersPanelOpen && "rotate-180")} aria-hidden />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-2 pb-2">
                  <div className="space-y-1">
                    {layerButton("props")}
                    {layerButton("projects")}
                    {layerButton("communities")}
                    {layerButton("activity", metricLayersAvailable ? undefined : t("map.layers.unavailable", locale))}
                    {layerButton("rent", metricLayersAvailable ? undefined : t("map.layers.unavailable", locale))}
                  </div>
                  {(layers.has("activity") || layers.has("rent")) && metricLayersAvailable && (
                    <p className="mt-2 border-t border-border/60 px-2 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                      {t("map.state.illustrative", locale)} · {t("map.layers.activityNote", locale)}
                    </p>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>

          {/* Mobile layers control (§16.1) — floating 44px trigger + bottom
              sheet; the lg+ Collapsible panel above stays the desktop surface. */}
          <Button
            variant="outline"
            size="sm"
            className="absolute start-3 top-3 z-[500] h-11 gap-1.5 bg-card/95 shadow-lg backdrop-blur lg:hidden"
            aria-expanded={layersSheetOpen}
            onClick={() => setLayersSheetOpen(true)}
          >
            <LayersIcon className="h-4 w-4" aria-hidden />
            {t("map.layers.title", locale)}
          </Button>
          <Sheet open={layersSheetOpen} onOpenChange={setLayersSheetOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[70vh] overflow-y-auto data-[state=open]:duration-200 data-[state=closed]:duration-150"
              aria-describedby={undefined}
            >
              <SheetHeader className="pb-2 text-left">
                <SheetTitle>{t("map.layers.title", locale)}</SheetTitle>
              </SheetHeader>
              <div className="space-y-1 px-4 pb-6">
                {layerButton("props", undefined, true)}
                {layerButton("projects", undefined, true)}
                {layerButton("communities", undefined, true)}
                {layerButton("activity", metricLayersAvailable ? undefined : t("map.layers.unavailable", locale), true)}
                {layerButton("rent", metricLayersAvailable ? undefined : t("map.layers.unavailable", locale), true)}
                {(layers.has("activity") || layers.has("rent")) && metricLayersAvailable && (
                  <p className="mt-2 border-t border-border/60 px-2 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t("map.state.illustrative", locale)} · {t("map.layers.activityNote", locale)}
                  </p>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Community quick-jump (lg+) */}
          <div className="absolute start-3 top-[3.75rem] z-[500] hidden max-h-[60%] w-52 overflow-y-auto scroll-elegant rounded-lg border border-border bg-card/95 p-2 shadow-lg backdrop-blur lg:block">
            <p className="kicker px-1 pb-1.5">{t("map.jump.title", locale)}</p>
            {communities.slice(0, 12).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => mapRef.current?.setView([c.lat, c.lng], 13)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-ui hover:bg-secondary"
              >
                <span className="truncate">{c.name}</span>
                <Crosshair className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>

          {tilesFailed && (
            <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-sand/90 p-8 text-center">
              <div className="max-w-sm">
                <MapPin className="mx-auto mb-3 h-10 w-10 text-brand" aria-hidden />
                <p className="font-semibold">{t("map.tiles.title", locale)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("map.tiles.body", locale)}</p>
                <Button asChild variant="outline" size="sm" className="mt-4 pointer-events-auto">
                  <Link to="/properties" query={Object.fromEntries(Object.entries(loc.query).filter(([k]) => !VIEWPORT_KEYS.has(k)))}>
                    {t("search.view.list", locale)}
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Selected property/project preview (in-map, keeps map state) */}
          {selected && (
            <div className="absolute inset-x-3 bottom-3 z-[500] mx-auto max-w-sm sm:inset-x-auto sm:start-3">
              <div className="relative rounded-xl border border-border bg-card shadow-xl">
                <button
                  type="button"
                  onClick={() => navigate("/properties/map", { ...loc.query, selected: undefined, selectedKind: undefined }, { replace: true })}
                  aria-label={t("map.preview.close", locale)}
                  className="absolute right-2 top-2 z-10 rounded-full bg-background/90 p-1.5 text-muted-foreground backdrop-blur transition-ui hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                {selected.kind === "property" && selected.listing ? (
                  <PropertyCard listing={selected.listing} compact />
                ) : selected.project ? (
                  <div className="p-4">
                    <p className="kicker">{selected.project.developer.name}</p>
                    <p className="mt-1 font-display text-base font-semibold leading-snug">{selected.project.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {selected.project.community.name} · {selected.project.status.replace(/_/g, " ").toLowerCase()}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="num text-sm font-semibold">
                        {selected.project.startingPrice
                          ? `${t("search.project.cardFrom", locale)} ${formatAEDPrecise(fromMinor(selected.project.startingPrice.minor))}`
                          : <UnavailableValue />}
                      </p>
                      {selected.project.handoverDate && (
                        <p className="text-xs text-muted-foreground">
                          {t("search.project.handover", locale)} {handoverQuarterLabel(selected.project.handoverDate)}
                        </p>
                      )}
                    </div>
                    <Button asChild size="sm" className="mt-3 w-full">
                      <Link to={`/projects/${selected.project.slug}`}>{t("map.preview.viewProject", locale)}</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Side list (lg+, §13 map/list synchronization) — two-way synced with the map */}
        <aside aria-label={t("map.list.title", locale)} className="hidden w-80 shrink-0 overflow-y-auto border-l border-border/70 bg-card p-3 scroll-elegant lg:block xl:w-96">
          <h2 className="kicker mb-2 flex items-center gap-1.5">
            <MapPinned className="h-3.5 w-3.5 text-brand" aria-hidden /> {t("map.list.title", locale)}
          </h2>
          {pagination}
          {loading ? (
            <LoadingState rows={4} />
          ) : mapError ? <p className="p-3 text-sm text-muted-foreground">{t("map.error.results", locale)}</p> : propertyList.length === 0 && projects.length === 0 ? (
            <EmptyState title={t("map.list.empty", locale)} description={t("map.list.emptyHint", locale)} />
          ) : (
            <div className="space-y-2.5">
              {propertyList.map((p) => (
                <button
                  key={p.id}
                  id={`map-result-${p.id}`}
                  type="button"
                  aria-pressed={selected?.listing?.id === p.id}
                  onMouseEnter={() => setHoveredSlug(p.slug)} onMouseLeave={() => setHoveredSlug(null)}
                  onFocus={() => setHoveredSlug(p.slug)} onBlur={() => setHoveredSlug(null)}
                  onClick={() => flyToItem("property", p.lat, p.lng, p.slug)}
                  className={cn(
                    "flex w-full gap-3 rounded-lg border border-border/70 bg-card p-2.5 text-left transition-ui hover:border-brand/40",
                    selected?.kind === "property" && selected.listing?.slug === p.slug && "border-brand/70 ring-1 ring-brand/40"
                  )}
                >
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-sand">
                    <PublicImage src={mediaPreviewUrl(p.cover) ?? undefined} alt="" className="h-full w-full object-cover" fallback={<MapPin className="m-auto mt-5 h-5 w-5 text-brand" aria-hidden />} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold">{p.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.community.name}</p>
                    <Price price={p.price} className="text-sm" />
                    <p className="mt-1 text-xs text-muted-foreground">{p.bedrooms} {t("search.nl.beds", locale)} · {p.bathrooms} {t("search.nl.baths", locale)}{p.isDemoData ? ` · ${t("map.state.illustrative", locale)}` : ""}</p>
                  </div>
                </button>
              ))}
              {layers.has("projects") &&
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => flyToItem("project", p.lat, p.lng, p.slug)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border border-border/70 bg-sand/40 p-2.5 text-left transition-ui hover:border-brand/40",
                      selected?.kind === "project" && selected.project?.slug === p.slug && "border-brand/70 ring-1 ring-brand/40"
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sand text-brand-strong">
                      <MapPin className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.community.name} · {p.developer.name}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </aside>
      </div>

      {/* Mobile results drawer (§13 mobile) */}
      <Drawer open={listOpen} onOpenChange={setListOpen}>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="fixed bottom-24 end-4 z-[500] rounded-full bg-brand px-4 py-3 text-sm font-semibold text-primary-foreground shadow-xl transition-ui hover:scale-105 lg:hidden"
            aria-expanded={listOpen}
          >
            <span className="inline-flex items-center gap-2">
              <ListIcon className="h-4 w-4" aria-hidden />
              {t("map.list.open", locale)} <span className="num rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{formatNumber(propertyList.length)}</span>
            </span>
          </button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[75vh]" aria-describedby={undefined}>
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-left">{t("map.list.title", locale)}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto scroll-elegant px-4 pb-6">
            {pagination}
            {loading ? (
              <LoadingState rows={3} />
            ) : mapError ? <p className="p-3 text-sm text-muted-foreground">{t("map.error.results", locale)}</p> : propertyList.length === 0 ? (
              <EmptyState title={t("map.list.empty", locale)} description={t("map.list.emptyHint", locale)} />
            ) : (
              <div className="space-y-3">
                {propertyList.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      flyToItem("property", p.lat, p.lng, p.slug);
                      setListOpen(false);
                    }}
                    className={cn(
                      "flex w-full gap-3 rounded-lg border border-border/70 bg-card p-2.5 text-left transition-ui hover:border-brand/40",
                      selected?.kind === "property" && selected.listing?.slug === p.slug && "border-brand/70 ring-1 ring-brand/40"
                    )}
                  >
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-sand">
                      <PublicImage src={mediaPreviewUrl(p.cover) ?? undefined} alt="" className="h-full w-full object-cover" fallback={<MapPin className="m-auto mt-5 h-5 w-5 text-brand" aria-hidden />} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.community.name}</p>
                      <Price price={p.price} className="text-sm" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Filter sheet (§16.1) — the shared search FilterPanel on the SAME URL
          params the map fetch reads (viewport keys always preserved); bottom
          sheet on mobile, side sheet on desktop. */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="max-h-[85vh] overflow-y-auto px-4 data-[state=open]:duration-200 data-[state=closed]:duration-150"
          aria-describedby={undefined}
        >
          <SheetHeader className="pb-2 text-left">
            <SheetTitle>{t("search.filters", locale)}</SheetTitle>
          </SheetHeader>
          <FilterPanel
            locale={locale}
            mode={mode}
            query={loc.query}
            facets={facets ?? undefined}
            communitiesForProjects={communities.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
            setParam={setFilterParam}
            onClearAll={clearAllFilters}
            inSheet
          />
          <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-background/95 p-4 backdrop-blur">
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>
              {t("search.filters.showResults", locale)}
              {propertyList.length ? ` (${formatNumber(propertyList.length)})` : ""}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

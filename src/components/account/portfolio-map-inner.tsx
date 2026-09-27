"use client";

/**
 * Portfolio map (V2 §25.2, U15) — 2D Leaflet, dynamic-imported (ssr:false).
 * Per §28 the portfolio map is analysis context, not a 3D twin: markers with
 * value pills, tooltips, click-to-open. 3D spatial views stay with the atlas.
 */
import * as React from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_TILE_CONFIG } from "@/lib/map-tiles";
import { formatAEDPrecise } from "@/lib/format-precise";
import { cn } from "@/lib/utils";
import type { PortfolioHolding } from "./portfolio-types";

const MARKER_BRONZE = "#8f5a2b";

function markerIcon(label: string, highlighted: boolean): L.DivIcon {
  const cls = cn(
    "num flex items-center justify-center whitespace-nowrap rounded-full border-2 px-2.5 py-1 text-xs font-semibold shadow-md transition-transform",
    highlighted
      ? "scale-125 border-ink bg-ink text-white"
      : "border-white bg-card text-brand-strong hover:scale-110"
  );
  const style = highlighted ? "" : `border-color:${MARKER_BRONZE}`;
  return L.divIcon({
    html: `<div class="${cls}" style="${style}">${label}</div>`,
    className: "",
    iconSize: [0, 0],
  });
}

function FitBounds({ items }: { items: PortfolioHolding[] }) {
  const map = useMap();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (fitted.current || !items.length) return;
    const lats = items.map((i) => i.lat as number);
    const lngs = items.map((i) => i.lng as number);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [48, 48], maxZoom: 14 }
    );
    fitted.current = true;
  }, [items, map]);
  return null;
}

export default function PortfolioMapInner({
  holdings,
  onSelect,
}: {
  holdings: PortfolioHolding[];
  onSelect?: (h: PortfolioHolding) => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const mappable = holdings.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-border/70 sm:h-96">
      <span className="sr-only" role="status">
        Portfolio map with {mappable.length} holdings.
      </span>
      <MapContainer
        center={[25.1, 55.2]}
        zoom={11}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ background: "#efe9dd" }}
        aria-label="Portfolio holdings map"
      >
        <TileLayer
          url={MAP_TILE_CONFIG.url}
          maxZoom={MAP_TILE_CONFIG.maxZoom}
          attribution={MAP_TILE_CONFIG.attribution}
        />
        <FitBounds items={mappable} />
        {mappable.map((h) => (
          <Marker
            key={h.id}
            position={[h.lat as number, h.lng as number]}
            icon={markerIcon(formatAEDPrecise(Number(h.valuation.minor) / 100), selected === h.id)}
            alt={`${h.label} — modeled value ${formatAEDPrecise(Number(h.valuation.minor) / 100)}`}
            eventHandlers={{
              click: () => {
                setSelected(h.id);
                onSelect?.(h);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <span className="text-xs">
                <span className="font-semibold">{h.label}</span>
                {h.community && <span className="block text-muted-foreground">{h.community.name}</span>}
                <span className="block">{formatAEDPrecise(Number(h.valuation.minor) / 100)} · {h.valuation.basis === "PURCHASE_PRICE" ? "user input" : "modeled"}</span>
              </span>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

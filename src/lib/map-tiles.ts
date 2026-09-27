/** One client-safe source of truth for every Leaflet base map. */
const requestedProvider = process.env.NEXT_PUBLIC_MAP_PROVIDER === "mapbox" ? "mapbox" : "osm";
const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? "";

export function escapeMapHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export const MAP_TILE_CONFIG = requestedProvider === "mapbox" && mapboxToken
  ? {
      provider: "mapbox" as const,
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(mapboxToken)}`,
      attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 20,
      fallbackReason: null,
    }
  : {
      provider: "osm" as const,
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      fallbackReason: requestedProvider === "mapbox" ? "missing public Mapbox token" : null,
    };

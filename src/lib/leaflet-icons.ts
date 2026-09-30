/** Deterministic branded pin; no asset loader or Leaflet default-icon state. */
export function propertyPinIcon(leaflet: Pick<typeof import("leaflet"), "divIcon">) {
  return leaflet.divIcon({
    html: '<svg aria-hidden="true" viewBox="0 0 28 36" width="28" height="36"><path d="M14 35S1 22 1 14a13 13 0 0 1 26 0c0 8-13 21-13 21Z" fill="#8f5a2b" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="white"/></svg>',
    className: "ie-property-pin drop-shadow-md",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -32],
  });
}

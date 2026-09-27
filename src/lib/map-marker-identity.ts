/** Include navigation/tooltip inputs so reused Leaflet callbacks cannot go stale. */
export function mapMarkerIdentity(markers: readonly {
  lat: number; lng: number; label: string; kind: string; href?: string; sublabel?: string;
}[]): string {
  return JSON.stringify(markers.map((m) => [m.lat, m.lng, m.label, m.kind, m.href, m.sublabel]));
}

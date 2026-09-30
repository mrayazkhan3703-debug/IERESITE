export function validMapPoint(lat: number, lng: number) { return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
export function mapViewport(query: Record<string, string>): { center: [number, number]; zoom: number } {
  const parts = query.c?.split(",").map(Number);
  const center: [number, number] = parts?.length === 2 && validMapPoint(parts[0], parts[1]) ? [parts[0], parts[1]] : [25.1, 55.2];
  const raw = Number(query.z);
  return { center, zoom: query.z && Number.isFinite(raw) ? Math.max(3, Math.min(19, raw)) : 11 };
}
/** Keep the searched area separate from the current, possibly panned viewport. */
export function mapBounds(value: string | undefined): [number, number, number, number] | null {
  const p = value?.split(",").map(Number);
  return p?.length === 4 && validMapPoint(p[1], p[0]) && validMapPoint(p[3], p[2]) && p[0] < p[2] && p[1] < p[3] ? [p[0], p[1], p[2], p[3]] : null;
}

/**
 * Shared atlas constants (U17 — V2 §29).
 *
 * - MARKER_BRONZE_HINT: --ie-viz-1 / --brand bronze as a literal hex (SVG /
 *   Leaflet / WebGL presentation values cannot host CSS var() references).
 * - COASTLINE: approximate Dubai Gulf coastline (lat, lng pairs, SW → NE) for
 *   the procedural 3D shore — ILLUSTRATIVE schematic only; communities are
 *   placed by their real recorded coordinates (§29 / §31 honesty rules).
 * - Palm Jumeirah approximation for the same schematic shore.
 */

export const MARKER_BRONZE_HINT = "#8f5a2b";

/** Approximate Gulf coastline SW→NE — illustrative, not surveyed geometry. */
export const COASTLINE: ReadonlyArray<readonly [number, number]> = [
  [24.96, 55.05],
  [25.0, 55.08],
  [25.05, 55.11],
  [25.08, 55.14],
  [25.11, 55.155],
  [25.14, 55.18],
  [25.18, 55.21],
  [25.22, 55.25],
  [25.27, 55.3],
  [25.32, 55.34],
  [25.37, 55.38],
];

/** Palm Jumeirah circle approximation (center + radius in degrees). */
export const PALM: { lat: number; lng: number; radiusDeg: number } = {
  lat: 25.112,
  lng: 55.138,
  radiusDeg: 0.024,
};

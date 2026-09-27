"use client";

/**
 * Shared Three.js utilities for the V2 3D layer (U17 atlas + U18 twin — §30/§55).
 *
 * - Hex palette: chart-theme tokens are CSS var() references which cannot be
 *   read by WebGL uniforms, so this module exports literal hex constants
 *   derived from the same tokens (source noted per constant). Light/dark mode
 *   switching is intentionally NOT applied inside the 3D scenes — they render
 *   a fixed stylised "night atlas" look consistent in both app themes.
 * - WebGL capability detection (§30.3 GPU checks) with a safe false default.
 * - prefers-reduced-motion (§43) — auto camera animation is suppressed.
 * - Recursive disposal of geometries / materials / textures (§30.3 / §55 —
 *   repeated navigation must not leak GPU memory).
 * - Sprite label helper (CanvasTexture — procedural, no external assets).
 *
 * This module itself MUST NOT statically import three — it is imported by
 * non-lazy host components; the three import stays inside the lazy scene
 * components so the chunk only loads when a scene actually mounts.
 */

import * as React from "react";

/* ------------------------------------------------------------------ */
/* Palette — hex literals mirroring src/app/globals.css tokens         */
/* ------------------------------------------------------------------ */

export const TWIN_HEX = {
  /** --ie-viz-1 / --brand (bronze) — same literal as map-view/entity-map */
  bronze: "#8f5a2b",
  /** --ie-viz-2 (warm sienna, oklch(0.63 0.058 55)) */
  sienna: "#a2673a",
  /** --ie-viz-3 (light gold, oklch(0.76 0.05 78)) */
  gold: "#d0a568",
  /** --ie-viz-4 (deep umber, oklch(0.36 0.045 60)) */
  umber: "#5c422f",
  /** --ie-viz-5 (pale sand, oklch(0.88 0.018 75)) */
  sand: "#e2d8c4",
  /** --ie-viz-6 (ink-neutral accent, oklch(0.3 0.012 60)) */
  inkNeutral: "#45423f",
  /** --ink (oklch(0.216 0.006 56)) */
  ink: "#33312d",
  /** --success (oklch(0.48 0.09 155)) — semantic only */
  success: "#3e7d59",
  /** neutral greys for unavailable/sold states */
  gray: "#8a8177",
  grayDark: "#565049",
  /** fixed stylised scene background (warm dark ink) */
  sceneBg: "#16130f",
  /** ground / land tone */
  land: "#241f19",
  /** sea tone (desaturated warm-neutral — brand red line: no blue) */
  sea: "#171310",
} as const;

/** Availability → colour (unit stack, §32). */
export const AVAILABILITY_HEX: Record<string, string> = {
  AVAILABLE: TWIN_HEX.bronze,
  RESERVED: TWIN_HEX.gray,
  SOLD: TWIN_HEX.grayDark,
  RENTED: TWIN_HEX.grayDark,
  HELD: TWIN_HEX.gray,
};

/** View-category palette (§33) — derived from the listing view field.
 *  Warm/earth family only (brand red line: no blue/indigo). */
export const VIEW_HEX: Record<string, string> = {
  SEA: "#6f8f7a" /* sage */,
  MARINA: TWIN_HEX.bronze,
  SKYLINE: TWIN_HEX.sienna,
  CITY: TWIN_HEX.gold,
  BOULEVARD: TWIN_HEX.umber,
  FULL_CITY: TWIN_HEX.sand,
  PARK: "#4e7a58" /* park green */,
  GOLF: "#7a8f4e" /* olive */,
};

/** Fallback for an unmapped view/availability value. */
export const FALLBACK_HEX = TWIN_HEX.inkNeutral;

/* ------------------------------------------------------------------ */
/* Capability + preference hooks                                       */
/* ------------------------------------------------------------------ */

/** WebGL support probe (§30.3 GPU capability checks). False until proven. */
export function webglSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return probeWebGLCanvas(document.createElement("canvas"));
  } catch {
    return false;
  }
}

/** Match the installed renderer's WebGL2 requirement and release probe ownership. */
export function probeWebGLCanvas(canvas: Pick<HTMLCanvasElement, "getContext">): boolean {
  const context = canvas.getContext("webgl2");
  if (!context) return false;
  try { return true; }
  finally { context.getExtension("WEBGL_lose_context")?.loseContext(); }
}

/** Reactive WebGL capability hook — { supported, checked } so hosts can wait
 *  for the probe before choosing a default mode (§30.3). */
export function useWebGL(): { supported: boolean; checked: boolean } {
  const [supported, setSupported] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  React.useEffect(() => {
    setSupported(webglSupported());
    setChecked(true);
  }, []);
  return { supported, checked };
}

/** prefers-reduced-motion (§43) — suppresses auto camera animation only;
 *  manual orbit interaction stays available. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Effective device pixel ratio for the renderer, clamped for perf (§55 mobile). */
export function clampedPixelRatio(performanceMode: boolean): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, performanceMode ? 1 : 1.5);
}

/* ------------------------------------------------------------------ */
/* Disposal helpers (§30.3 / §55)                                      */
/* ------------------------------------------------------------------ */

type Disposable = { dispose: () => void };

/** Recursively dispose a scene graph: geometries, materials, textures. */
export function disposeObject3D(root: {
  traverse?: (cb: (obj: unknown) => void) => void;
  children?: unknown[];
}, ownedResources: Disposable[] = []): void {
  const disposed = new Set<Disposable>();
  const disposeResource = (value: unknown) => {
    if (!value || typeof value !== "object" || !("dispose" in value) || typeof value.dispose !== "function") return;
    const resource = value as Disposable;
    if (disposed.has(resource)) return;
    disposed.add(resource);
    for (const [key, field] of Object.entries(value)) {
      if (field && typeof field === "object" && (key === "map" || ("isTexture" in field && field.isTexture))) {
        disposeResource(field);
      }
    }
    resource.dispose();
  };
  root.traverse?.((obj: unknown) => {
    const o = obj as {
      geometry?: Disposable | null;
      material?: Disposable | Disposable[] | null;
      map?: Disposable | null;
    };
    disposeResource(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      disposeResource(m);
    }
  });
  // Palettes/empty shared geometries may never be attached to a mesh.
  for (const resource of ownedResources) disposeResource(resource);
}

/* ------------------------------------------------------------------ */
/* Sprite label helper (procedural CanvasTexture — no external assets) */
/* ------------------------------------------------------------------ */

/**
 * Build a canvas-texture sprite label. Returns the canvas plus pixel size;
 * the caller wraps it in a THREE.CanvasTexture + THREE.Sprite (three is
 * imported lazily by the scene components, never here).
 */
export function makeLabelCanvas(
  text: string,
  opts?: { color?: string; font?: string; width?: number; height?: number }
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const w = opts?.width ?? 256;
  const h = opts?.height ?? 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = opts?.font ?? "600 26px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // subtle ink pill behind the text for legibility over the scene
    const metrics = ctx.measureText(text);
    const padX = 14;
    const pillW = Math.min(w - 4, metrics.width + padX * 2);
    ctx.fillStyle = "rgba(22,19,15,0.78)";
    ctx.beginPath();
    ctx.roundRect((w - pillW) / 2, 8, pillW, h - 16, 12);
    ctx.fill();
    ctx.fillStyle = opts?.color ?? TWIN_HEX.sand;
    ctx.fillText(text, w / 2, h / 2 + 1);
  }
  return { canvas, width: w, height: h };
}

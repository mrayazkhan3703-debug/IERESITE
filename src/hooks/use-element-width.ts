"use client";

import * as React from "react";

/**
 * Tracks an element's content-box width via ResizeObserver (V3-F).
 * Used by market charts to thin crowded x-axis ticks on narrow screens
 * (§40 tick-density: labels must not overlap at 320–375px). Returns null
 * until the first observation fires — callers keep their default layout.
 */
export function useElementWidth<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  width: number | null;
} {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect?.width ?? el.getBoundingClientRect().width;
        setWidth(Math.round(w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

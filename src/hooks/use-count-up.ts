"use client";

import * as React from "react";

/**
 * V3 §17 KPI count-up — animates 0 → target ONCE when the host element
 * enters the viewport (IntersectionObserver, rAF-driven, ease-out cubic).
 *
 * Motion contract:
 * - SSR, no-JS, prefers-reduced-motion, or no IntersectionObserver ⇒ the
 *   EXACT final value renders immediately (never a stuck 0).
 * - 900ms default duration (§17 allows 600–1000ms for intros).
 * - The final frame always sets the exact target value (no rounding drift).
 * - Zero layout shift: format the display with tabular-nums so digit-width
 *   changes do not reflow neighboring cells.
 */

export function useCountUp<T extends HTMLElement = HTMLSpanElement>(
  target: number | null | undefined,
  options?: { duration?: number; threshold?: number }
): { ref: React.RefObject<T | null>; value: number | null } {
  const ref = React.useRef<T | null>(null);
  const duration = options?.duration ?? 900;
  const threshold = options?.threshold ?? 0.35;

  /* Server/no-JS/reduced-motion baseline = the exact final value. */
  const [display, setDisplay] = React.useState<number | null>(target ?? null);

  React.useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setDisplay(target ?? null);
      return;
    }
    setDisplay(target);

    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        setDisplay(0);
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(p >= 1 ? target : Math.round(target * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, duration, threshold]);

  return { ref, value: display };
}

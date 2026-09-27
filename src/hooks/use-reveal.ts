"use client";

import * as React from "react";

/**
 * V3 §17 section reveal — IntersectionObserver + inline styles only.
 *
 * Motion contract:
 * - Content is fully visible in SSR HTML, without JS, and under
 *   prefers-reduced-motion (the hidden state is never applied there).
 * - Only elements that are BELOW the viewport at hydration time get the
 *   pre-paint hidden state (opacity 0, translateY 12px), so there is no
 *   visible flash of content and zero CLS (transform/opacity only —
 *   no layout property ever changes).
 * - Reveal fires ONCE when the element enters the viewport
 *   (opacity 0 → 1, translateY 12px → 0 over 240ms), then disconnects.
 */

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  /** Initial offset in px (§17 allows 8–16). Default 12. */
  distance?: number;
  /** Duration in ms (§17 UI band 150–350). Default 240. */
  duration?: number;
}): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const distance = options?.distance ?? 12;
  const duration = options?.duration ?? 240;

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* Reduced motion / no observer support → never hide anything. */
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* Elements already on screen stay visible — no flash, no missing content. */
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) return;

    el.style.opacity = "0";
    el.style.transform = `translateY(${distance}px)`;
    el.style.transition = `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.style.opacity = "1";
          el.style.transform = "translateY(0px)";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [distance, duration]);

  return ref;
}

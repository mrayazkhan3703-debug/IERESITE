"use client";

/**
 * Gallery V2 (V2 §14.1 + V3 §5.9/§19.1) — responsive gallery.
 *
 * - Desktop (≥sm): 16:10 hero + 2–4 supporting tiles in a balanced mosaic
 *   (aspect-locked, no dead whitespace).
 * - Mobile (<sm): a SINGLE swipeable hero carousel — horizontal scroll-snap
 *   strip (native touch momentum, `.overflow-x-safe` containment), a "1 / 3"
 *   pagination badge that tracks the snapped slide, tap → full-screen
 *   lightbox, and ←/→ keyboard stepping when the strip is focused (direction-
 *   aware for RTL). No cramped multi-column mosaic at ≤640px.
 * - "View all photos (N)" opens a full-screen lightbox Dialog: keyboard ←/→ + Esc,
 *   "3 / 12" counter, captions, focus-trapped (Radix aria-modal).
 * - Video indicator renders ONLY when the media set actually contains a VIDEO asset;
 *   3D-tour indicator is omitted entirely until an API field exists (no fake chips).
 * - Floor-plan shortcut chip scrolls to the floor-plans section when assets exist.
 */

import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Layers, Images, Play, ChevronLeft, ChevronRight, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaDTO } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

export function GalleryV2({
  media,
  title,
  locale = "en",
  hasFloorPlans,
}: {
  media: MediaDTO[];
  title: string;
  locale?: Locale;
  hasFloorPlans: boolean;
}) {
  const [index, setIndex] = React.useState<number | null>(null);
  const [slide, setSlide] = React.useState(0);
  const open = index !== null;
  const trackRef = React.useRef<HTMLDivElement>(null);

  const images = React.useMemo(() => media.filter((m) => m.kind !== "VIDEO"), [media]);
  const videoIndex = React.useMemo(() => {
    const i = media.findIndex((m) => m.kind === "VIDEO");
    return i === -1 ? null : i;
  }, [media]);

  const hero = images[0] ?? null;
  const tiles = images.slice(1, 5);
  const total = media.length;

  // Lightbox indices address the FULL media array (videos included), so mosaic
  // clicks must map their image back to its media position — images[0] is not
  // necessarily media[0] when a VIDEO asset sorts ahead of it.
  const mediaIndexOf = (m: MediaDTO) => {
    const i = media.indexOf(m);
    return i === -1 ? 0 : i;
  };

  const close = () => setIndex(null);
  const step = (dir: 1 | -1) => setIndex((i) => (i === null ? i : (i + dir + media.length) % media.length));

  /* --------------------------------------------------------------- */
  /* Mobile carousel (§19.1) — snap index tracks the scroll position   */
  /* --------------------------------------------------------------- */

  const rafRef = React.useRef<number | null>(null);
  const onTrackScroll = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      // RTL Chromium reports scrollLeft in [-max, 0]; Math.abs unifies both.
      const i = Math.min(images.length - 1, Math.max(0, Math.round(Math.abs(el.scrollLeft) / el.clientWidth)));
      setSlide(i);
    });
  };
  React.useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  /* Keyboard stepping while the strip is focused — direction-aware (RTL:
   * the forward slide sits visually to the LEFT, so ArrowLeft advances). */
  const onTrackKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const el = trackRef.current;
    if (!el) return;
    e.preventDefault();
    const rtl = getComputedStyle(el).direction === "rtl";
    const forward = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
    el.scrollBy({ left: el.clientWidth * (forward ? 1 : -1) * (rtl ? -1 : 1), behavior: "smooth" });
  };

  // Keyboard navigation (§14.1): ←/→ while the lightbox is open; Esc closes via Radix.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, media.length]);

  const scrollToFloorPlans = () => {
    document.getElementById("floorplans")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!hero && total === 0) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-xl bg-sand text-muted-foreground/50" role="img" aria-label={`${title} — no photos provided`}>
        <Layers className="h-12 w-12" aria-hidden />
        <span className="sr-only">No photos provided for this listing.</span>
      </div>
    );
  }

  const captionFor = (m: MediaDTO) => m.altText ?? m.caption ?? title;

  return (
    <div>
      {/* Media-type shortcut chips (only for data that actually exists) */}
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2 print:hidden">
        {hasFloorPlans && (
          <button
            type="button"
            onClick={scrollToFloorPlans}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-ui hover:border-brand/50 hover:text-brand-strong"
          >
            <Ruler className="h-3.5 w-3.5" aria-hidden /> {t("property.gallery.floorPlan", locale)}
          </button>
        )}
        {videoIndex !== null && (
          <button
            type="button"
            onClick={() => setIndex(videoIndex)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-ui hover:border-brand/50 hover:text-brand-strong"
          >
            <Play className="h-3.5 w-3.5" aria-hidden /> {t("property.gallery.video", locale)}
          </button>
        )}
      </div>

      {/* Mobile: single swipeable hero carousel (§5.9/§19.1) — snap strip + count badge */}
      {images.length > 0 && (
        <div className="relative sm:hidden print:hidden">
          <div
            ref={trackRef}
            role="region"
            aria-label={`${title} — ${t("property.gallery.carouselAria", locale)}`}
            tabIndex={0}
            onScroll={onTrackScroll}
            onKeyDown={onTrackKeyDown}
            className="scroll-elegant flex aspect-[16/10] w-full snap-x snap-mandatory gap-0 overflow-x-safe rounded-xl"
          >
            {images.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setIndex(mediaIndexOf(m))}
                className="relative h-full w-full shrink-0 snap-center"
                aria-label={`${t("property.gallery.viewPhoto", locale)} ${i + 1}`}
              >
                <img
                  src={m.url}
                  alt={captionFor(m)}
                  loading={i === 0 ? undefined : "lazy"}
                  draggable={false}
                  className="h-full w-full select-none object-cover"
                />
              </button>
            ))}
          </div>
          {/* Pagination count "1 / 3" (aria-live so swipes are announced) */}
          <span
            className="num absolute bottom-3 end-3 z-10 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
            aria-live="polite"
            aria-label={`${slide + 1} / ${images.length}`}
          >
            {slide + 1} / {images.length}
          </span>
        </div>
      )}

      {/* Mosaic (≥sm) — desktop composition unchanged */}
      <div className="hidden gap-2 sm:grid sm:grid-cols-4 sm:grid-rows-2 print:block">
        {/* Hero — spans 2×2 */}
        <button
          type="button"
          onClick={() => setIndex(mediaIndexOf(hero))}
          className="group relative col-span-2 row-span-2 overflow-hidden rounded-xl bg-sand print:aspect-[16/9] print:w-full"
          aria-label={t("property.gallery.openAria", locale)}
        >
          <img
            src={hero.url}
            alt={captionFor(hero)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-ink/25 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
        </button>

        {/* Supporting tiles */}
        {tiles.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setIndex(mediaIndexOf(m))}
            className={cn(
              "group relative aspect-[4/3] overflow-hidden rounded-xl bg-sand print:hidden",
              // Lock the two top-right cells into the 2-row mosaic without gaps
              i < 2 ? "row-span-1" : ""
            )}
            aria-label={`${t("property.gallery.viewPhoto", locale)} ${i + 2}`}
          >
            <img
              src={m.url}
              alt={captionFor(m)}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
            {i === tiles.length - 1 && total > 5 && (
              <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-sm font-semibold text-white backdrop-blur-[2px]">
                +{total - 5}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* View all photos (≥sm; on mobile the carousel itself browses + tap-to-lightbox) */}
      {total > 0 && (
        <div className="mt-3 hidden justify-end print:hidden sm:flex">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setIndex(images.length > 0 ? mediaIndexOf(images[0]) : 0)}>
            <Images className="h-4 w-4" aria-hidden />
            {t("property.gallery.viewAll", locale)} ({total})
          </Button>
        </div>
      )}

      {/* Full-screen lightbox (aria-modal + focus trap via Radix Dialog) */}
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent
          className="max-h-[100dvh] max-w-[100vw] gap-0 overflow-hidden border-0 bg-ink/95 p-0 sm:rounded-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{title} — {t("property.gallery.lightboxTitle", locale)}</DialogTitle>
          {index !== null && media[index] && (
            <div className="relative flex h-[100dvh] w-full items-center justify-center">
              {/* Counter */}
              <span className="absolute left-4 top-4 z-10 rounded-full bg-ink/70 px-3 py-1 text-sm font-semibold text-white backdrop-blur" aria-live="polite">
                <span className="num">{index + 1}</span> / <span className="num">{media.length}</span>
              </span>

              {media[index].kind === "VIDEO" ? (
                /* Genuine video asset — plays inline in the lightbox (§14.1) */
                <video
                  poster={media[index].posterUrl ?? undefined}
                  src={media[index].url}
                  controls
                  autoPlay
                  playsInline
                  aria-label={captionFor(media[index])}
                  className="max-h-[86dvh] max-w-full select-none"
                />
              ) : (
                <img
                  src={media[index].url}
                  alt={captionFor(media[index])}
                  className="max-h-[86dvh] max-w-full object-contain select-none"
                />
              )}

              {/* Prev / next — 44px targets, hidden from print/screenshots of page */}
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t("property.gallery.prev", locale)}
                className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-white backdrop-blur transition-ui hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t("property.gallery.next", locale)}
                className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-white backdrop-blur transition-ui hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight className="h-6 w-6" aria-hidden />
              </button>

              {/* Caption */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-gradient-to-t from-ink/90 to-transparent px-4 pb-4 pt-10">
                <p className="min-w-0 truncate text-sm text-white/90">{captionFor(media[index])}</p>
                <span className="hidden shrink-0 text-xs text-white/60 sm:block" aria-hidden>
                  ← → {t("property.gallery.keyboardHint", locale)}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

/**
 * Floor plans V2 (V2 §14.6).
 *
 * - Grid of genuine property assets; clicking opens a viewer Dialog with
 *   zoom (+/− buttons & double-click), pan (pointer-drag), and a direct
 *   download link (`download` attribute on the media URL).
 * - Accessibility: descriptive img alt + sr-only explanation inviting dimension
 *   verification with an advisor.
 * - Source-asset honesty (§53): every figure carries the caption note
 *   "Source asset provided by developer; labels shown as provided" — developer
 *   plans are never re-drawn or re-labeled by this platform.
 */

import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Download, Maximize2, Info } from "lucide-react";
import { formatNumber, formatMoney } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import type { MediaDTO } from "@/lib/types";

export interface FloorPlanEntry {
  id: string;
  label: string | null;
  bedrooms: number | null;
  areaSqft: number | null;
  priceMinor: string | null;
  media: MediaDTO;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function FloorPlanViewer({
  floorPlans,
  title,
  currency = "AED",
  locale = "en",
}: {
  floorPlans: FloorPlanEntry[];
  title: string;
  currency?: string;
  locale?: Locale;
}) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const open = openIndex !== null;
  const active = openIndex !== null ? floorPlans[openIndex] : null;

  const openPlan = (i: number) => {
    setOpenIndex(i);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const zoomBy = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)));
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  // Double-click toggles between 1× and a comfortable inspection zoom.
  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setScale((s) => (s > 1.05 ? 1 : 2.5));
    setOffset({ x: 0, y: 0 });
  };

  // Pointer-based pan (mouse + touch unified; container opts out of native gestures).
  // `dragging` mirrors the ref into state so the render below never reads the ref.
  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1.001) return; // nothing to pan at 1×
    // Pointer capture keeps pan tracking when the finger leaves the canvas;
    // synthetic/lost pointer ids can reject it — pan still works without.
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore — event stream still delivers pointermove */
    }
    setDragging(true);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setOffset({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  if (floorPlans.length === 0) return null;

  return (
    <section id="floorplans" aria-labelledby="floorplans-heading" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="floorplans-heading" className="font-display text-xl font-semibold">
          {t("property.floorplans.title", locale)}
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("property.floorplans.sourceNote", locale)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {floorPlans.map((fp, i) => (
          <figure key={fp.id} className="group overflow-hidden rounded-xl border border-border/70 bg-card">
            <button
              type="button"
              onClick={() => openPlan(i)}
              className="relative block w-full cursor-zoom-in"
              aria-label={`${t("property.floorplans.openAria", locale)}${fp.label ? `: ${fp.label}` : ""}`}
            >
              <img
                src={fp.media.url}
                alt={fp.media.altText ?? `${title} — ${fp.label ?? "floor plan"}`}
                loading="lazy"
                className="aspect-[4/3] w-full bg-sand object-contain"
              />
              <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100" aria-hidden>
                <Maximize2 className="h-4 w-4" />
              </span>
            </button>
            <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 p-3 text-sm">
              <span className="font-medium">{fp.label ?? <span className="italic text-muted-foreground/70">{t("property.floorplans.unlabeled", locale)}</span>}</span>
              <span className="num text-muted-foreground">
                {fp.areaSqft ? `${formatNumber(fp.areaSqft)} sqft` : ""}
                {fp.priceMinor ? ` · ${formatMoney(fp.priceMinor, { currency })}` : ""}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Viewer dialog — zoom / pan / download (§14.6) */}
      <Dialog open={open} onOpenChange={(o) => !o && setOpenIndex(null)}>
        <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0 sm:rounded-xl" aria-describedby={undefined}>
          <DialogTitle className="sr-only">
            {title} — {active?.label ?? t("property.floorplans.title", locale)}
          </DialogTitle>
          {active && (
            <div className="flex flex-col">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card px-4 py-2.5">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{active.label ?? t("property.floorplans.title", locale)}</p>
                  <p className="num text-xs text-muted-foreground">
                    {active.bedrooms !== null && `${formatNumber(active.bedrooms)} ${t("property.floorplans.beds", locale)} · `}
                    {active.areaSqft ? `${formatNumber(active.areaSqft)} sqft · ` : ""}
                    <span className="num">{Math.round(scale * 100)}%</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 print:hidden">
                  <Button variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => zoomBy(-0.5)} disabled={scale <= MIN_SCALE} aria-label={t("property.floorplans.zoomOut", locale)}>
                    <ZoomOut className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => zoomBy(0.5)} disabled={scale >= MAX_SCALE} aria-label={t("property.floorplans.zoomIn", locale)}>
                    <ZoomIn className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={reset} disabled={scale === 1 && offset.x === 0 && offset.y === 0} aria-label={t("property.floorplans.reset", locale)}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button asChild variant="outline" size="sm" className="ml-1 h-11 gap-1.5 sm:h-9">
                    <a href={active.media.url} download>
                      <Download className="h-4 w-4" aria-hidden /> {t("property.floorplans.download", locale)}
                    </a>
                  </Button>
                </div>
              </div>

              {/* Pannable canvas */}
              <div
                className="relative h-[70vh] w-full touch-none overflow-hidden bg-sand"
                onDoubleClick={onDoubleClick}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
              >
                <img
                  src={active.media.url}
                  alt={active.media.altText ?? `${title} — ${active.label ?? "floor plan"}`}
                  draggable={false}
                  className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none"
                  style={{
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
                    transformOrigin: "center",
                    cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
                    transition: dragging ? "none" : "transform 150ms ease-out",
                  }}
                />
                <p className="sr-only">
                  {t("property.floorplans.srDescription", locale)}
                </p>
              </div>

              <p className="flex items-center justify-center gap-1.5 border-t border-border/70 bg-card px-4 py-2 text-center text-[11px] text-muted-foreground">
                {t("property.floorplans.panHint", locale)} · {t("property.floorplans.sourceNote", locale)}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

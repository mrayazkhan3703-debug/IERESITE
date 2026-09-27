"use client";

/**
 * Project digital-twin section host (U18 — V2 §31/§32/§33).
 *
 * Non-lazy host that owns:
 *  - "Project massing" (§31): IO-gated lazy Three.js massing block (procedural
 *    simplified geometry — source CAD/BIM/GLB unavailable, §31 allowance) with
 *    orientation compass + illustrative sun; static SVG elevation fallback
 *    when WebGL is unavailable.
 *  - "Tower & unit explorer" (§32): 3D unit stack (lazy Three.js) with a
 *    "3D view / Table view" toggle — the U07 UnitInventory table IS the 2D
 *    analytical fallback (§28: every 3D capability has a usable 2D fallback).
 *    Default is 3D when WebGL is available, table otherwise.
 *  - Performance-mode switch (§55 mobile capability handling).
 *
 * Three.js itself is only ever imported by the lazy children
 * (React.lazy + IntersectionObserver — §30.3/§42), never by this module.
 */

import * as React from "react";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import { UnitInventory } from "@/components/project/unit-inventory";
import { useWebGL } from "@/components/twin/three-utils";
import { Switch } from "@/components/ui/switch";
import { Compass, Gauge, Layers3, Loader2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TwinProjectInfo, TwinUnitRow } from "@/components/twin/unit-stack-explorer";

/* Lazy 3D chunks — three.js loads only when these mount (§30.3). */
const ProjectMassing = React.lazy(() => import("@/components/twin/project-massing"));
const UnitStackExplorer = React.lazy(() => import("@/components/twin/unit-stack-explorer"));

/* Static 2D elevation fallback for the massing block (no WebGL). */
function MassingFallback({ locale }: { locale: Locale }) {
  return (
    <div className="relative h-64 w-full overflow-hidden rounded-xl border border-border/70 bg-[#16130f] sm:h-72" role="img" aria-label={t("twin.massing.disclaimer", locale)}>
      <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="massing-tower" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8f5a2b" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#5c422f" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {/* sun (illustrative) */}
        <circle cx="266" cy="26" r="9" fill="#d0a568" />
        {/* tower + podium (simplified elevation) */}
        <rect x="120" y="36" width="34" height="96" fill="url(#massing-tower)" stroke="#d0a568" strokeWidth="1" />
        <rect x="160" y="72" width="22" height="60" fill="url(#massing-tower)" stroke="#d0a568" strokeWidth="1" opacity="0.8" />
        <rect x="96" y="122" width="118" height="14" fill="#a2673a" opacity="0.55" stroke="#d0a568" strokeWidth="0.75" />
        {/* ground line */}
        <line x1="24" y1="138" x2="296" y2="138" stroke="#e2d8c4" strokeWidth="1" opacity="0.5" />
        {/* compass (north up) */}
        <g transform="translate(40,44)">
          <circle r="16" fill="none" stroke="#e2d8c4" strokeWidth="1" opacity="0.6" />
          <path d="M0,-11 L4,6 L0,2 L-4,6 Z" fill="#d0a568" />
          <text x="0" y="-20" textAnchor="middle" fill="#d0a568" fontSize="10" fontWeight="700">N</text>
        </g>
      </svg>
      <p className="absolute bottom-2 start-2 max-w-[70%] rounded-lg bg-[#16130f]/85 px-3 py-1.5 text-[11px] leading-snug text-[#e2d8c4]/85">
        {t("twin.massing.disclaimer", locale)}
      </p>
    </div>
  );
}

export function ProjectTwinSection({
  project,
  units,
  rentBenchmark,
  locale = "en",
  onEnquire,
}: {
  project: TwinProjectInfo;
  units: TwinUnitRow[];
  rentBenchmark: number | null;
  locale?: Locale;
  onEnquire: () => void;
}) {
  const { supported: webgl, checked: webglChecked } = useWebGL();
  const [viewMode, setViewMode] = React.useState<"3d" | "table" | null>(null);
  const [performanceMode, setPerformanceMode] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [massingFailed, setMassingFailed] = React.useState(false);
  const handleMassingFailure = React.useCallback(() => setMassingFailed(true), []);
  const sectionRef = React.useRef<HTMLDivElement>(null);

  /* Default view: 3D when WebGL is available, table otherwise (§32 fallback). */
  React.useEffect(() => {
    if (webglChecked && viewMode === null) setViewMode(webgl ? "3d" : "table");
  }, [webglChecked, webgl, viewMode]);

  /* IntersectionObserver — the 3D chunks load only when scrolled near (§30.3). */
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "250px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const maxFloor = React.useMemo(() => {
    const floors = units.map((u) => u.floor ?? 0);
    return floors.length ? Math.max(...floors) : null;
  }, [units]);

  const mount3d = visible && webgl;

  return (
    <div ref={sectionRef} className="space-y-10">
      {/* ------------------------- §31 Project massing ------------------------- */}
      <section aria-labelledby="twin-massing-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="twin-massing-heading" className="font-display text-xl font-semibold">
            {t("twin.massing.title", locale)}
          </h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            {t("twin.massing.sub", locale)}
          </p>
        </div>
        <div className="relative mt-4">
          {mount3d && !massingFailed ? (
            <React.Suspense
              fallback={
                <div className="flex h-64 items-center justify-center rounded-xl border border-border/70 bg-[#16130f] text-sm text-[#e2d8c4]/80 sm:h-72">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> {t("twin.explorer.loading", locale)}
                </div>
              }
            >
              <ProjectMassing maxFloor={maxFloor} unitCount={units.length} performanceMode={performanceMode} onError={handleMassingFailure} />
            </React.Suspense>
          ) : (
            webglChecked && <MassingFallback locale={locale} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("twin.massing.disclaimer", locale)} · {t("twin.massing.sun", locale)}
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t("atlas.controls.performanceHint", locale)}>
            <Gauge className="h-3.5 w-3.5" aria-hidden />
            <span>{t("atlas.controls.performance", locale)}</span>
            <Switch checked={performanceMode} onCheckedChange={setPerformanceMode} aria-label={t("atlas.controls.performance", locale)} />
          </label>
        </div>
      </section>

      {/* --------------------- §32 Tower & unit explorer --------------------- */}
      <section aria-labelledby="twin-explorer-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="twin-explorer-heading" className="font-display text-xl font-semibold">
            {t("twin.explorer.title", locale)}
          </h2>
          {/* 3D / Table toggle — the table IS the 2D analytical fallback (§28) */}
          <div className="inline-flex rounded-lg border border-border/70 bg-card p-0.5" role="tablist" aria-label={t("twin.explorer.title", locale)}>
            {(["3d", "table"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                disabled={!webgl && mode === "3d"}
                title={!webgl && mode === "3d" ? t("atlas.webgl.unavailable", locale) : undefined}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-ui",
                  viewMode === mode ? "bg-brand-soft text-brand-strong" : "text-muted-foreground hover:text-foreground",
                  !webgl && mode === "3d" && "cursor-not-allowed opacity-50"
                )}
              >
                {mode === "3d" ? <Layers3 className="h-4 w-4" aria-hidden /> : <Table2 className="h-4 w-4" aria-hidden />}
                {mode === "3d" ? t("twin.explorer.view3d", locale) : t("twin.explorer.viewTable", locale)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("twin.explorer.sub", locale)} ·{" "}
          <span className="num">{formatNumber(units.length)}</span>
        </p>

        {viewMode === "3d" && mount3d && (
          <div className="mt-4">
            <React.Suspense
              fallback={
                <div className="flex h-[26rem] items-center justify-center rounded-xl border border-border/70 bg-[#16130f] text-sm text-[#e2d8c4]/80 sm:h-[30rem]">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> {t("twin.explorer.loading", locale)}
                </div>
              }
            >
              <UnitStackExplorer
                project={project}
                units={units}
                rentBenchmark={rentBenchmark}
                locale={locale}
                onEnquire={onEnquire}
                performanceMode={performanceMode}
                onError={() => setViewMode("table")}
              />
            </React.Suspense>
          </div>
        )}

        {(viewMode === "table" || !mount3d) && (
          <div className="mt-4">
            <UnitInventory
              slug={project.slug}
              units={units}
              currency={project.currency}
              locale={locale}
              onEnquire={onEnquire}
            />
          </div>
        )}

        {viewMode === null && (
          <div className="mt-4 flex h-24 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-sm text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> {t("common.loading", locale)}
          </div>
        )}
      </section>
    </div>
  );
}

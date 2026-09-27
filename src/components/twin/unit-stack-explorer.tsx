"use client";

/**
 * 3D Unit Stack Explorer (U18 — V2 §32 core deliverable + §33 view colours).
 *
 * Procedural floor × unit grid: every recorded unit is one block stacked by
 * its recorded floor (tower-parsed unit numbers create side-by-side towers;
 * floor-less inventories render as an honest ground row). Blocks are coloured
 * by availability (§32) or by view category (§33 — derived from the listing
 * view field, explicitly NOT a precise sight-line). Source CAD/BIM/GLB data
 * is unavailable in this environment, so the geometry is a simplified,
 * clearly labelled representation (§31 allowance).
 *
 * 2D fallback: the host section offers the U07 unit table (same data).
 *
 * Loaded exclusively through React.lazy — statically imports three
 * (route-split 3D chunk, §30.3/§42). Full §55 teardown on unmount.
 */

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Link } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import { formatAEDPrecise, fullValueTooltip } from "@/lib/format-precise";
import { StatusBadge, UnavailableValue } from "@/components/common";
import { DataStateBadge } from "@/components/common/data-state";
import { useSavedStore } from "@/components/providers/saved-provider";
import { events } from "@/lib/analytics-tracker";
import { towerOfUnitNumber, humanizeTitle } from "@/components/entity/entity-shared";
import type { ListingCardDTO } from "@/lib/types";
import { toast } from "sonner";
import {
  AVAILABILITY_HEX,
  FALLBACK_HEX,
  TWIN_HEX,
  VIEW_HEX,
  clampedPixelRatio,
  disposeObject3D,
  makeLabelCanvas,
} from "@/components/twin/three-utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calculator, ExternalLink, LayoutGrid, MessageSquare, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { manageSceneFrames, releaseSceneRenderer } from "@/components/twin/scene-lifecycle";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TwinUnitRow {
  id: string;
  unitNumber: string | null;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: string | null;
  currency: string;
  availabilityStatus: string;
  floor: number | null;
  aspect: string | null;
  propertySlug: string | null;
}

export interface TwinProjectInfo {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  currency: string;
  isDemoData: boolean;
  community: { id: string; name: string; slug: string };
  developer: { id: string; name: string; slug: string };
  paymentPlans: { name: string; postHandover: boolean; installments: { percent: number; label: string }[] }[];
}

interface UnitFilters {
  type: string | null;
  beds: string | null;
  view: string | null;
  status: string | null;
  priceMin: string | null;
  priceMax: string | null;
  sizeMin: string | null;
  sizeMax: string | null;
}

const NO_FILTERS: UnitFilters = {
  type: null,
  beds: null,
  view: null,
  status: null,
  priceMin: null,
  priceMax: null,
  sizeMin: null,
  sizeMax: null,
};

/* Scene constants (illustrative scale — clearly labelled, §31/§32) */
const FLOOR_GAP = 1.05;
const UNIT_W = 1.15;
const UNIT_H = 0.7;
const UNIT_D = 1.15;
const UNIT_SPACING = 1.5;

/* ------------------------------------------------------------------ */
/* Small UI atoms                                                      */
/* ------------------------------------------------------------------ */

function FilterChip({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-ui",
        disabled && "cursor-not-allowed opacity-50",
        active ? "border-brand bg-brand-soft text-brand-strong" : "border-border/70 bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function RangeInput({
  label,
  value,
  onChange,
  placeholder,
  step,
  ariaLabel,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  step: number;
  ariaLabel: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{ariaLabel}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        step={step}
        min={0}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="num h-9 w-24 rounded-lg border border-border/70 bg-card px-2.5 text-xs font-medium text-foreground transition-ui focus:border-brand focus:outline-none"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function UnitStackExplorer({
  project,
  units,
  rentBenchmark,
  locale = "en",
  onEnquire,
  performanceMode = false,
  onError,
}: {
  project: TwinProjectInfo;
  units: TwinUnitRow[];
  rentBenchmark: number | null;
  locale?: Locale;
  onEnquire: () => void;
  performanceMode?: boolean;
  onError?: () => void;
}) {
  /* ------------------------------ filters ------------------------------ */
  const [filters, setFilters] = React.useState<UnitFilters>(NO_FILTERS);
  const [colorBy, setColorBy] = React.useState<"availability" | "view">("availability");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<{ id: string; x: number; y: number } | null>(null);

  const setFilter = <K extends keyof UnitFilters>(key: K, value: UnitFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const types = React.useMemo(() => [...new Set(units.map((u) => u.unitType))].sort(), [units]);
  const beds = React.useMemo(() => [...new Set(units.map((u) => u.bedrooms))].sort((a, b) => a - b), [units]);
  const views = React.useMemo(
    () => [...new Set(units.map((u) => u.aspect).filter((v): v is string => !!v))].sort(),
    [units]
  );
  const statuses = React.useMemo(() => [...new Set(units.map((u) => u.availabilityStatus))].sort(), [units]);

  const filtered = React.useMemo(() => {
    const pMin = filters.priceMin ? Number(filters.priceMin) : null;
    const pMax = filters.priceMax ? Number(filters.priceMax) : null;
    const sMin = filters.sizeMin ? Number(filters.sizeMin) : null;
    const sMax = filters.sizeMax ? Number(filters.sizeMax) : null;
    return units.filter((u) => {
      if (filters.type && u.unitType !== filters.type) return false;
      if (filters.beds && String(u.bedrooms) !== filters.beds) return false;
      if (filters.view && u.aspect !== filters.view) return false;
      if (filters.status && u.availabilityStatus !== filters.status) return false;
      if (pMin !== null || pMax !== null) {
        const price = u.priceMinor ? Number(u.priceMinor) / 100 : null;
        if (price === null) return false;
        if (pMin !== null && price < pMin) return false;
        if (pMax !== null && price > pMax) return false;
      }
      if (sMin !== null || sMax !== null) {
        if (u.areaSqft === null) return false;
        if (sMin !== null && u.areaSqft < sMin) return false;
        if (sMax !== null && u.areaSqft > sMax) return false;
      }
      return true;
    });
  }, [units, filters]);

  const filteredIdsKey = React.useMemo(() => filtered.map((u) => u.id).join(","), [filtered]);
  const selected = React.useMemo(() => units.find((u) => u.id === selectedId) ?? null, [units, selectedId]);
  const anyFilter = React.useMemo(
    () => Object.values(filters).some((v) => v !== null && v !== ""),
    [filters]
  );

  const selectUnit = React.useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) {
        const unit = units.find((u) => u.id === id);
        events.unitSelected(project.slug, unit?.unitNumber ?? null);
      }
    },
    [units, project.slug]
  );

  /* ------------------------------ 3D scene ------------------------------ */
  const hostRef = React.useRef<HTMLDivElement>(null);
  /* Latest filter/selection state pushed into the render loop (ref write only —
     material swaps happen inside the scene effect, compiler-safe). */
  const sceneStateRef = React.useRef<{ key: string; matchSet: Set<string>; colorBy: "availability" | "view"; selectedId: string | null }>({
    key: "",
    matchSet: new Set<string>(),
    colorBy: "availability",
    selectedId: null,
  });
  React.useEffect(() => {
    sceneStateRef.current = {
      key: `${filteredIdsKey}|${colorBy}|${selectedId ?? ""}`,
      matchSet: new Set(filteredIdsKey ? filteredIdsKey.split(",") : []),
      colorBy,
      selectedId,
    };
  }, [filteredIdsKey, colorBy, selectedId]);
  /* Stable selection callback for pointer handlers (avoids scene rebuilds). */
  const selectUnitRef = React.useRef(selectUnit);
  React.useEffect(() => {
    selectUnitRef.current = selectUnit;
  }, [selectUnit]);
  const [sceneError, setSceneError] = React.useState(false);
  const errorRef = React.useRef(onError);
  React.useEffect(() => { errorRef.current = onError; }, [onError]);

  /* Build scene once per units/performanceMode — meshes persist; materials
     are swapped by the update effect below (no rebuild on filter changes). */
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !performanceMode });
    } catch (err) {
      console.error("[unit-stack] WebGL renderer creation failed", err);
      setSceneError(true);
      onError?.();
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(TWIN_HEX.sceneBg);
    scene.fog = new THREE.Fog(TWIN_HEX.sceneBg, 80, 200);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
    renderer.setPixelRatio(clampedPixelRatio(performanceMode));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true"); // HTML side card + table carry the data
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xf3e6cf, 0.6));
    const key = new THREE.DirectionalLight(0xf0d9a8, 1.0);
    key.position.set(18, 30, 12);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd8c39a, 0.35);
    rim.position.set(-14, 10, -18);
    scene.add(rim);

    /* ground + grid */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: TWIN_HEX.land, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(160, 40, 0x5a4630, 0x332a1f);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    /* shared materials */
    const mkMat = (hex: string) =>
      new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(hex), emissiveIntensity: 0.12 });
    const availabilityMats = new Map<string, THREE.MeshStandardMaterial>();
    for (const [status, hex] of Object.entries(AVAILABILITY_HEX)) availabilityMats.set(status, mkMat(hex));
    const viewMats = new Map<string, THREE.MeshStandardMaterial>();
    for (const [aspect, hex] of Object.entries(VIEW_HEX)) viewMats.set(aspect, mkMat(hex));
    const dim = new THREE.MeshStandardMaterial({
      color: TWIN_HEX.inkNeutral,
      transparent: true,
      opacity: 0.14,
      roughness: 0.9,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const selectedMat = new THREE.MeshStandardMaterial({
      color: TWIN_HEX.gold,
      roughness: 0.35,
      metalness: 0.45,
      emissive: new THREE.Color(TWIN_HEX.gold),
      emissiveIntensity: 0.55,
    });

    /* -------------- layout: towers × floors × unit boxes -------------- */
    const towers = new Map<string, Map<number | null, TwinUnitRow[]>>();
    for (const u of units) {
      const towerKey = towerOfUnitNumber(u.unitNumber) ?? "";
      let tower = towers.get(towerKey);
      if (!tower) {
        tower = new Map();
        towers.set(towerKey, tower);
      }
      const bucket = tower.get(u.floor);
      if (bucket) bucket.push(u);
      else tower.set(u.floor, [u]);
    }
    const towerKeys = [...towers.keys()].sort();
    const meshIndex = new Map<string, THREE.Mesh>();
    const unitGeo = new THREE.BoxGeometry(UNIT_W, UNIT_H, UNIT_D);

    const maxFloorOverall = Math.max(0, ...units.map((u) => u.floor ?? 0));
    let spanX = 0;

    towerKeys.forEach((towerKey, ti) => {
      const floors = towers.get(towerKey)!;
      const floorNums = [...floors.keys()];
      const numbered = floorNums.filter((f): f is number => f !== null).sort((a, b) => a - b);
      const hasNumbered = numbered.length > 0;
      const maxPerFloor = Math.max(...floorNums.map((f) => floors.get(f)!.length), 1);
      const coreW = maxPerFloor * UNIT_SPACING + 1.1;
      const groupX = ti * (coreW + 7) - ((towerKeys.length - 1) * (coreW + 7)) / 2;
      spanX = Math.max(spanX, Math.abs(groupX) + coreW / 2);

      /* tower core (semi-transparent, purely illustrative context) */
      if (hasNumbered) {
        const coreH = (numbered[numbered.length - 1] + 0.5) * FLOOR_GAP;
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(coreW, coreH, coreW * 0.72),
          new THREE.MeshStandardMaterial({
            color: TWIN_HEX.bronze,
            transparent: true,
            opacity: 0.16,
            roughness: 0.6,
            depthWrite: false,
          })
        );
        core.position.set(groupX, coreH / 2, 0);
        scene.add(core);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(core.geometry),
          new THREE.LineBasicMaterial({ color: TWIN_HEX.umber, transparent: true, opacity: 0.5 })
        );
        edges.position.copy(core.position);
        scene.add(edges);

        /* floor labels on the leading side */
        for (const f of numbered) {
          const lbl = makeLabelCanvas(`F${f}`, {
            color: TWIN_HEX.sand,
            font: "600 22px ui-sans-serif, system-ui, sans-serif",
            width: 96,
            height: 44,
          });
          const tex = new THREE.CanvasTexture(lbl.canvas);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
          sprite.scale.set(2.2, 1.0, 1);
          sprite.position.set(groupX - coreW / 2 - 1.9, f * FLOOR_GAP + UNIT_H / 2, 0);
          scene.add(sprite);
        }
      } else {
        /* ground row base plate for floor-less inventories (e.g. villas) */
        const count = floors.get(null)?.length ?? 0;
        const rowW = count * UNIT_SPACING + 1.4;
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(rowW, 0.14, UNIT_D + 2.2),
          new THREE.MeshStandardMaterial({ color: TWIN_HEX.umber, transparent: true, opacity: 0.35, roughness: 0.8 })
        );
        plate.position.set(groupX, 0.07, 0);
        scene.add(plate);
      }

      /* unit blocks */
      for (const [floor, floorUnits] of floors) {
        const y = floor !== null ? floor * FLOOR_GAP + UNIT_H / 2 : 0.14 + UNIT_H / 2;
        floorUnits.forEach((u, j) => {
          const x = groupX + (j - (floorUnits.length - 1) / 2) * UNIT_SPACING;
          const mesh = new THREE.Mesh(unitGeo, dim);
          mesh.position.set(x, y, 0);
          mesh.userData = { unitId: u.id };
          meshIndex.set(u.id, mesh);
          scene.add(mesh);
        });
      }

      /* tower name label above the tallest point */
      const topY = (hasNumbered ? numbered[numbered.length - 1] * FLOOR_GAP : UNIT_H) + 1.6;
      if (towerKey) {
        const lbl = makeLabelCanvas(
          `${t("twin.filters.tower", locale)} ${towerKey}`,
          { color: TWIN_HEX.gold, font: "700 26px ui-sans-serif, system-ui, sans-serif" }
        );
        const tex = new THREE.CanvasTexture(lbl.canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.scale.set(7.5, 1.9, 1);
        sprite.position.set(groupX, topY, 0);
        scene.add(sprite);
      } else if (!hasNumbered) {
        const lbl = makeLabelCanvas(t("twin.filters.noFloor", locale), {
          color: TWIN_HEX.sand,
          font: "600 22px ui-sans-serif, system-ui, sans-serif",
        });
        const tex = new THREE.CanvasTexture(lbl.canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.scale.set(8.5, 1.9, 1);
        sprite.position.set(groupX, topY, 0);
        scene.add(sprite);
      }
    });

    /* ---------------- camera auto-fit ---------------- */
    const height = Math.max(maxFloorOverall * FLOOR_GAP, 3);
    const span = Math.max(spanX * 2 + 6, 8);
    camera.position.set(span * 0.55, height * 0.72 + 4, span * 0.62 + height * 0.55);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 220;
    controls.maxPolarAngle = Math.PI * 0.47; // never below the ground plane (§30)
    controls.target.set(0, height * 0.42, 0);

    /* ---------------- picking ---------------- */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (ev: PointerEvent): TwinUnitRow | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...meshIndex.values()], false);
      const hitId = hits.length ? (hits[0].object.userData.unitId as string) : null;
      return hitId ? units.find((u) => u.id === hitId) ?? null : null;
    };
    let hoveredMesh: THREE.Mesh | null = null;
    let downAt: { x: number; y: number } | null = null;

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return; // hover is mouse-only; touch selects on tap
      const unit = pick(ev);
      if (hoveredMesh) hoveredMesh.scale.setScalar(1);
      hoveredMesh = unit ? meshIndex.get(unit.id) ?? null : null;
      if (hoveredMesh) hoveredMesh.scale.setScalar(1.18);
      setHover(unit ? { id: unit.id, x: ev.clientX - host.getBoundingClientRect().left, y: ev.clientY - host.getBoundingClientRect().top } : null);
    };
    const onPointerDown = (ev: PointerEvent) => {
      downAt = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
      downAt = null;
      if (moved > 6) return; // it was a drag, not a tap
      const unit = pick(ev);
      selectUnitRef.current(unit ? unit.id : null);
    };
    const onLeave = () => {
      if (hoveredMesh) hoveredMesh.scale.setScalar(1);
      hoveredMesh = null;
      setHover(null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    /* ---------------- resize + loop ---------------- */
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* ---------------- render loop + in-place material swaps ----------------
     * Filter/colour/selection changes are pushed via sceneStateRef (plain
     * data — never rebuilt); the loop applies them to the local meshes only
     * when the state key actually changed. */
    let appliedKey = "";
    const applyUnitStyles = () => {
      const state = sceneStateRef.current;
      for (const [id, mesh] of meshIndex) {
        const unit = units.find((u) => u.id === id);
        if (!unit) continue;
        if (id === state.selectedId) {
          mesh.material = selectedMat;
        } else if (!state.matchSet.has(id)) {
          mesh.material = dim;
        } else if (state.colorBy === "view") {
          mesh.material = unit.aspect ? viewMats.get(unit.aspect) ?? dim : dim;
        } else {
          mesh.material = availabilityMats.get(unit.availabilityStatus) ?? dim;
        }
        if (mesh !== hoveredMesh) mesh.scale.setScalar(1);
      }
    };

    const tick = () => {
      const state = sceneStateRef.current;
      if (state.key !== appliedKey) {
        appliedKey = state.key;
        applyUnitStyles();
      }
      controls.update();
      renderer.render(scene, camera);
    };
    const stopFrames = manageSceneFrames(host, renderer.domElement, tick, () => {
      setSceneError(true);
      errorRef.current?.();
    });
    applyUnitStyles(); // initial paint

    /* ---------------- teardown (§55 — no leaks on repeat nav) ---------------- */
    return () => {
      stopFrames();
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      disposeObject3D(scene, [unitGeo, dim, selectedMat, ...availabilityMats.values(), ...viewMats.values()]);
      releaseSceneRenderer(renderer);
    };
     
  }, [units, performanceMode, locale]);

  /* ------------------------------ side card helpers ------------------------------ */
  const savedStore = useSavedStore();
  const plan = project.paymentPlans[0] ?? null;
  const planSummary = plan
    ? [
        `${plan.name} — ${formatNumber(plan.installments.length)} installments`,
        `(${plan.installments
          .slice(0, 4)
          .map((i) => `${formatNumber(i.percent)}%`)
          .join(" + ")}${plan.installments.length > 4 ? " …" : ""})`,
        plan.postHandover ? t("project.plan.postHandover", locale) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : t("twin.unit.planNone", locale);

  const addToCompare = (unit: TwinUnitRow) => {
    if (!unit.propertySlug || !unit.priceMinor) return;
    const listing: ListingCardDTO = {
      id: unit.propertySlug,
      slug: unit.propertySlug,
      title: `Unit ${unit.unitNumber ?? ""} — ${project.name}`,
      propertyType: unit.unitType,
      listingType: "SALE",
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      areaSqft: unit.areaSqft,
      price: { minor: unit.priceMinor, currency: unit.currency },
      availabilityStatus: unit.availabilityStatus,
      offPlan: true,
      isFeatured: false,
      isExclusive: false,
      community: project.community,
      project: { id: project.slug, name: project.name, slug: project.slug },
      developer: project.developer,
      agent: null,
      cover: null,
      lat: project.lat,
      lng: project.lng,
      isDemoData: project.isDemoData,
    };
    if (savedStore.compare.length >= 4) {
      toast(t("twin.unit.cta.compareMax", locale));
      return;
    }
    savedStore.toggleCompare(listing);
    toast(t("twin.unit.cta.compare", locale));
  };

  const hoverUnit = hover ? units.find((u) => u.id === hover.id) ?? null : null;

  /* Legend entries for the active colour mode */
  const legend = colorBy === "view" ? views.map((v) => ({ key: v, hex: VIEW_HEX[v] ?? FALLBACK_HEX })) : statuses.map((s) => ({ key: s, hex: AVAILABILITY_HEX[s] ?? FALLBACK_HEX }));

  const row = (label: string, value: React.ReactNode, title?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="num min-w-0 text-end font-medium" title={title}>{value}</dd>
    </div>
  );

  return (
    <div>
      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("twin.explorer.colorBy", locale)}>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.explorer.colorBy", locale)}</span>
          <FilterChip active={colorBy === "availability"} onClick={() => setColorBy("availability")}>
            {t("twin.explorer.colorBy.availability", locale)}
          </FilterChip>
          {views.length > 0 && (
            <FilterChip active={colorBy === "view"} onClick={() => setColorBy("view")} title={t("twin.explorer.viewNote", locale)}>
              {t("twin.explorer.colorBy.view", locale)}
            </FilterChip>
          )}
        </div>
        <p className="num text-sm text-muted-foreground">
          {t("twin.filters.matching", locale).replace("{n}", formatNumber(filtered.length)).replace("{total}", formatNumber(units.length))}
          {anyFilter && (
            <button type="button" onClick={() => setFilters(NO_FILTERS)} className="ms-3 text-xs font-medium text-brand-strong underline underline-offset-2 transition-ui hover:text-brand">
              {t("twin.filters.clear", locale)}
            </button>
          )}
        </p>
      </div>

      {/* ------------------------------ filters ------------------------------ */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3" role="group" aria-label={t("twin.filters.label", locale)}>
        {types.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.type", locale)}</span>
            {types.map((ty) => (
              <FilterChip key={ty} active={filters.type === ty} onClick={() => setFilter("type", filters.type === ty ? null : ty)}>
                {humanizeTitle(ty)}
              </FilterChip>
            ))}
          </div>
        )}
        {beds.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.beds", locale)}</span>
            {beds.map((b) => (
              <FilterChip key={b} active={filters.beds === String(b)} onClick={() => setFilter("beds", filters.beds === String(b) ? null : String(b))}>
                {b === 0 ? t("project.units.studio", locale) : formatNumber(b)}
              </FilterChip>
            ))}
          </div>
        )}
        {views.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.view", locale)}</span>
            {views.map((v) => (
              <FilterChip key={v} active={filters.view === v} onClick={() => setFilter("view", filters.view === v ? null : v)} title={t("twin.explorer.viewNote", locale)}>
                {humanizeTitle(v)}
              </FilterChip>
            ))}
          </div>
        )}
        {statuses.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.availability", locale)}</span>
            {statuses.map((s) => (
              <FilterChip key={s} active={filters.status === s} onClick={() => setFilter("status", filters.status === s ? null : s)}>
                {humanizeTitle(s)}
              </FilterChip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.price", locale)}</span>
            <RangeInput
              label={t("twin.filters.min", locale)}
              value={filters.priceMin}
              onChange={(v) => setFilter("priceMin", v)}
              placeholder="—"
              step={50000}
              ariaLabel={t("twin.filters.price", locale) + " min"}
            />
            <RangeInput
              label={t("twin.filters.max", locale)}
              value={filters.priceMax}
              onChange={(v) => setFilter("priceMax", v)}
              placeholder="—"
              step={50000}
              ariaLabel={t("twin.filters.price", locale) + " max"}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("twin.filters.size", locale)}</span>
            <RangeInput
              label={t("twin.filters.min", locale)}
              value={filters.sizeMin}
              onChange={(v) => setFilter("sizeMin", v)}
              placeholder="—"
              step={100}
              ariaLabel={t("twin.filters.size", locale) + " min"}
            />
            <RangeInput
              label={t("twin.filters.max", locale)}
              value={filters.sizeMax}
              onChange={(v) => setFilter("sizeMax", v)}
              placeholder="—"
              step={100}
              ariaLabel={t("twin.filters.size", locale) + " max"}
            />
          </div>
        </div>
      </div>

      {/* ------------------------------ canvas + overlays ------------------------------ */}
      <div className="relative mt-4 overflow-hidden rounded-xl border border-border/70 bg-[#16130f]">
        <div
          ref={hostRef}
          data-scene-host="units"
          className="h-[26rem] w-full sm:h-[30rem]"
          role="img"
          aria-label={t("twin.sr.scene", locale)}
        />
        <span className="sr-only">{t("twin.sr.tableNote", locale)}</span>

        {/* legend (HTML — §33 view colours / §32 availability) */}
        <div className="pointer-events-none absolute bottom-3 start-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-[#16130f]/80 px-3 py-2 text-[11px] font-medium text-sand backdrop-blur-sm">
          {legend.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: l.hex }} aria-hidden />
              {humanizeTitle(l.key)}
            </span>
          ))}
          {colorBy === "view" && <span className="text-sand/70">{t("twin.explorer.viewNote", locale)}</span>}
        </div>

        {/* disclaimer (§31/§32 — simplified representation) */}
        <p className="absolute end-3 top-3 max-w-[16rem] rounded-lg bg-[#16130f]/80 px-3 py-2 text-[11px] leading-snug text-sand/85 backdrop-blur-sm">
          {t("twin.explorer.disclaimer", locale)}
        </p>

        {/* hover tooltip */}
        {hoverUnit && hover && (
          <div
            className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-lg border border-border/60 bg-card px-3 py-1.5 text-xs font-medium shadow-lg"
            style={{ left: Math.max(8, hover.x), top: Math.max(28, hover.y - 8) }}
          >
            <span className="num">
              {t("twin.hover.unit", locale)
                .replace("{u}", hoverUnit.unitNumber ?? hoverUnit.id.slice(0, 6))
                .replace("{p}", hoverUnit.priceMinor ? formatAEDPrecise(Number(hoverUnit.priceMinor) / 100) : "—")}
            </span>
          </div>
        )}

        {/* selected unit side card (overlay md+, in-flow on mobile) */}
        {selected && (
          <aside
            className="mt-3 border-t border-border/60 bg-card p-4 md:absolute md:bottom-3 md:end-3 md:top-3 md:mt-0 md:w-[19rem] md:rounded-xl md:border md:border-border/70 md:shadow-xl"
            aria-label={`${t("twin.unit.title", locale)} ${selected.unitNumber ?? ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="kicker">{t("twin.unit.title", locale)}</p>
                <p className="num font-display text-lg font-semibold">{selected.unitNumber ?? selected.id.slice(0, 8)}</p>
              </div>
              <button
                type="button"
                onClick={() => selectUnit(null)}
                aria-label={t("twin.unit.close", locale)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <dl className="mt-2">
              {row(t("twin.unit.floor", locale), selected.floor !== null ? formatNumber(selected.floor) : <UnavailableValue />)}
              {row(t("twin.unit.type", locale), humanizeTitle(selected.unitType))}
              {row(
                t("twin.unit.beds", locale),
                selected.bedrooms === 0 ? t("project.units.studio", locale) : formatNumber(selected.bedrooms)
              )}
              {row(t("twin.unit.size", locale), selected.areaSqft ? `${formatNumber(selected.areaSqft)} sqft` : <UnavailableValue />)}
              {row(
                t("twin.unit.price", locale),
                selected.priceMinor ? formatAEDPrecise(Number(selected.priceMinor) / 100) : <UnavailableValue />,
                selected.priceMinor ? fullValueTooltip(Number(selected.priceMinor) / 100) : undefined
              )}
              {row(t("twin.unit.view", locale), selected.aspect ? humanizeTitle(selected.aspect) : <UnavailableValue />)}
            </dl>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.availabilityStatus} />
            </div>

            <div className="mt-3 rounded-lg bg-sand/60 p-3">
              <p className="kicker mb-1">{t("twin.unit.plan", locale)}</p>
              <p className="text-xs leading-relaxed text-foreground/85">{planSummary}</p>
            </div>

            {/* CTAs (§32 actions) */}
            <div className="mt-3 space-y-2">
              {selected.propertySlug ? (
                <Button asChild size="sm" className="w-full gap-2">
                  <Link to={`/properties/${selected.propertySlug}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.viewUnit", locale)}
                  </Link>
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <Button size="sm" variant="outline" className="w-full cursor-not-allowed gap-2 opacity-60" disabled aria-disabled>
                        <ExternalLink className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.viewUnit", locale)}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[16rem]">{t("twin.unit.cta.viewUnitNone", locale)}</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button size="sm" variant="outline" className="w-full cursor-not-allowed gap-2 opacity-60" disabled aria-disabled>
                      <LayoutGrid className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.floorPlan", locale)}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[16rem]">{t("twin.unit.cta.floorPlanNone", locale)}</TooltipContent>
              </Tooltip>

              {selected.priceMinor ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild size="sm" variant="outline" className="w-full gap-2">
                      <Link
                        to="/calculators/roi"
                        query={{
                          price: Number(selected.priceMinor) / 100,
                          ...(rentBenchmark ? { rent: rentBenchmark } : {}),
                        }}
                      >
                        <Calculator className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.analysis", locale)}
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[18rem]">
                    {t("twin.unit.cta.analysisNote", locale).replace(
                      "{rent}",
                      rentBenchmark ? t("twin.unit.cta.analysisRent", locale) : ""
                    )}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <Button size="sm" variant="outline" className="w-full cursor-not-allowed gap-2 opacity-60" disabled aria-disabled>
                        <Calculator className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.analysis", locale)}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[16rem]">{t("twin.unit.planNone", locale)}</TooltipContent>
                </Tooltip>
              )}

              <div className="flex gap-2">
                {selected.propertySlug && selected.priceMinor ? (
                  <Button size="sm" variant="outline" className="flex-1 gap-2" onClick={() => addToCompare(selected)}>
                    <Plus className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.compare", locale)}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1">
                        <Button size="sm" variant="outline" className="w-full cursor-not-allowed gap-2 opacity-60" disabled aria-disabled>
                          <Plus className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.compare", locale)}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[16rem]">{t("twin.unit.cta.compareNone", locale)}</TooltipContent>
                  </Tooltip>
                )}
                <Button size="sm" className="flex-1 gap-2" onClick={onEnquire}>
                  <MessageSquare className="h-4 w-4" aria-hidden /> {t("twin.unit.cta.enquire", locale)}
                </Button>
              </div>
            </div>

            {/* rent benchmark provenance (MODELED, §32) */}
            {rentBenchmark && selected.priceMinor && (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <DataStateBadge state="MODELED" />
                <span>
                  {t("community.metric.AVG_RENT_1BR", locale)}: {formatAEDPrecise(rentBenchmark)} —{" "}
                  {project.community.name}
                </span>
              </p>
            )}
          </aside>
        )}
      </div>

      {sceneError && (
        <p className="mt-2 text-sm text-muted-foreground">{t("twin.massing.fallback", locale)}</p>
      )}
    </div>
  );
}

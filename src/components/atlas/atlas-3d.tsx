"use client";

/**
 * Atlas 3D scene (U17 — V2 §29.3): Three.js spatial view of Dubai.
 *
 * - Communities placed by their REAL recorded lat/lng (local Mercator-style
 *   projection) as semi-transparent bronze columns whose height scales with
 *   the selected metric (§29.3 community metric extrusions).
 * - Projects layer: gold octahedron point markers at real coordinates.
 * - Procedural ILLUSTRATIVE coastline + Palm circle (atlas-shared constants)
 *   over a dark ground plane with bronze grid lines — clearly labelled as a
 *   simplified representation, never actual terrain/building geometry (§31).
 * - Hover tooltip (HTML overlay, DataStateBadge included), click → selection
 *   (scene state preserved — the panel is an overlay, §29.5).
 * - OrbitControls: drag rotate / pinch zoom / wheel zoom; polar angle clamped
 *   so the camera never goes below ground (§30).
 * - reduced-motion: no automatic camera easing (manual interaction intact);
 *   performance mode: pixel ratio clamp 1 + no antialias (§55 mobile).
 *
 * Loaded exclusively through React.lazy — statically imports three
 * (route-split 3D chunk, §30.3/§42). Full §55 teardown on unmount.
 */

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import type { MetricState } from "@/lib/data-state";
import { DataStateBadge } from "@/components/common/data-state";
import {
  formatAtlasMetricValue,
  type AtlasCommunity,
  type AtlasMetricKey,
  type AtlasProject,
} from "@/components/atlas/atlas-data";
import { COASTLINE, PALM } from "@/components/atlas/atlas-shared";
import { TWIN_HEX, clampedPixelRatio, disposeObject3D, makeLabelCanvas } from "@/components/twin/three-utils";
import { manageSceneFrames, releaseSceneRenderer } from "@/components/twin/scene-lifecycle";

/* ------------------------------------------------------------------ */
/* Local projection — real coordinates → scene units                   */
/* ------------------------------------------------------------------ */

const LAT0 = 25.12;
const LNG0 = 55.2;
const M_PER_DEG = 111320;
/** 1 scene unit ≈ 1.2 km (whole-emirate extent ≈ 40 × 30 units). */
const WORLD_SCALE = 1 / 1200;

function project(lat: number, lng: number): [number, number] {
  const x = (lng - LNG0) * Math.cos((LAT0 * Math.PI) / 180) * M_PER_DEG * WORLD_SCALE;
  const z = -(lat - LAT0) * M_PER_DEG * WORLD_SCALE;
  return [x, z];
}

const CAMERA_HOME = { position: new THREE.Vector3(6, 46, 64), target: new THREE.Vector3(0, 0, -2) };

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface Atlas3DProps {
  communities: AtlasCommunity[];
  projects: AtlasProject[];
  metricKey: AtlasMetricKey;
  layers: { communities: boolean; projects: boolean };
  selectedCommunity: string | null;
  onSelectCommunity: (slug: string | null) => void;
  onSelectProject: (slug: string) => void;
  performanceMode?: boolean;
  reducedMotion?: boolean;
  /** Increment to reset the camera to the home view. */
  resetSignal?: number;
  /** Set to a community slug to fly the camera to it (consumed by parent). */
  flyTo?: string | null;
  locale?: Locale;
  onUnavailable?: () => void;
}

interface HoverInfo {
  kind: "community" | "project";
  name: string;
  x: number;
  y: number;
  value: string | null;
  state: MetricState | null;
}

export default function Atlas3DScene({
  communities,
  projects,
  metricKey,
  layers,
  selectedCommunity,
  onSelectCommunity,
  onSelectProject,
  performanceMode = false,
  reducedMotion = false,
  resetSignal = 0,
  flyTo = null,
  locale = "en",
  onUnavailable,
}: Atlas3DProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const columnRefs = React.useRef<Map<string, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; baseY: number }>>(new Map());
  const projectGroupRef = React.useRef<THREE.Group | null>(null);
  const communityGroupRef = React.useRef<THREE.Group | null>(null);
  const camGoalRef = React.useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const hoverRef = React.useRef<string | null>(null); // "community:slug" | "project:slug"

  /* metricKeyRef for pick closures (avoids scene rebuilds on metric change) */
  const metricKeyRef = React.useRef(metricKey);

  /* Stable callback refs for picking (avoid scene rebuilds). */
  const selectRef = React.useRef(onSelectCommunity);
  const selectProjectRef = React.useRef(onSelectProject);
  React.useEffect(() => {
    selectRef.current = onSelectCommunity;
    selectProjectRef.current = onSelectProject;
    metricKeyRef.current = metricKey;
  }, [onSelectCommunity, onSelectProject, metricKey]);
  const communitiesRef = React.useRef(communities);
  React.useEffect(() => {
    communitiesRef.current = communities;
  }, [communities]);

  /* ------------------------------ build scene ------------------------------ */
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !performanceMode });
    } catch (err) {
      console.error("[atlas-3d] WebGL renderer creation failed", err);
      onUnavailable?.();
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(TWIN_HEX.sceneBg);
    scene.fog = new THREE.Fog(TWIN_HEX.sceneBg, 120, 300);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
    camera.position.copy(CAMERA_HOME.position);

    renderer.setPixelRatio(clampedPixelRatio(performanceMode));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true"); // data lives in the DOM table/panel
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xf3e6cf, 0.5));
    const sun = new THREE.DirectionalLight(0xf0d9a8, 0.95);
    sun.position.set(40, 60, 20);
    scene.add(sun);

    /* ---------------- sea + land + coastline (illustrative) ---------------- */
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: TWIN_HEX.sea, roughness: 1 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.06;
    scene.add(sea);

    const coastPts = COASTLINE.map(([lat, lng]) => project(lat, lng));
    /* Land polygon: coast polyline closed on the SE side. */
    const first = coastPts[0];
    const last = coastPts[coastPts.length - 1];
    const landShape = new THREE.Shape([
      ...coastPts.map(([x, z]) => new THREE.Vector2(x, -z)),
      new THREE.Vector2(last[0] + 18, -last[1]),
      new THREE.Vector2(last[0] + 18, -(last[1] - 18)),
      new THREE.Vector2(first[0] - 18, -(first[1] + 18)),
      new THREE.Vector2(first[0] - 18, -first[1]),
    ]);
    const land = new THREE.Mesh(
      new THREE.ShapeGeometry(landShape),
      new THREE.MeshStandardMaterial({ color: TWIN_HEX.land, roughness: 1 })
    );
    land.rotation.x = -Math.PI / 2;
    scene.add(land);

    const grid = new THREE.GridHelper(90, 45, 0x6b4a2a, 0x3a2f22);
    grid.position.y = 0.05;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    /* Coastline stroke */
    const coastGeo = new THREE.BufferGeometry().setFromPoints([
      ...coastPts.map(([x, z]) => new THREE.Vector3(x, 0.12, z)),
    ]);
    scene.add(
      new THREE.Line(coastGeo, new THREE.LineBasicMaterial({ color: TWIN_HEX.gold, transparent: true, opacity: 0.75 }))
    );

    /* Palm Jumeirah circle approximation */
    const [px, pz] = project(PALM.lat, PALM.lng);
    const palmPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      palmPts.push(new THREE.Vector3(px + Math.cos(a) * PALM.radiusDeg * M_PER_DEG * WORLD_SCALE, 0.12, pz + Math.sin(a) * PALM.radiusDeg * M_PER_DEG * WORLD_SCALE));
    }
    scene.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(palmPts), new THREE.LineBasicMaterial({ color: TWIN_HEX.gold, transparent: true, opacity: 0.55 }))
    );

    /* ---------------- community columns (real coordinates) ---------------- */
    const communityGroup = new THREE.Group();
    communityGroupRef.current = communityGroup;
    scene.add(communityGroup);
    columnRefs.current = new Map();

    const values = communities.map((c) => c.metrics[metricKey]?.value ?? null).filter((v): v is number => v !== null);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;

    for (const c of communities) {
      const [x, z] = project(c.lat, c.lng);
      const metric = c.metrics[metricKey];
      const norm = metric && max > min ? (metric.value - min) / (max - min) : 0;
      const h = metric ? 2 + norm * 11 : 0.7; // no data → honest low dim stub
      const mat = new THREE.MeshStandardMaterial({
        color: metric ? TWIN_HEX.bronze : TWIN_HEX.inkNeutral,
        transparent: true,
        opacity: metric ? 0.55 : 0.22,
        roughness: 0.5,
        metalness: 0.25,
        emissive: new THREE.Color(TWIN_HEX.bronze),
        emissiveIntensity: 0.1,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.scale.set(0.95, h, 0.95);
      mesh.position.set(x, h / 2, z);
      mesh.userData = { kind: "community", slug: c.slug };
      communityGroup.add(mesh);
      columnRefs.current.set(c.slug, { mesh, mat, baseY: h / 2 });

      /* name label above the column */
      const lbl = makeLabelCanvas(c.name, { color: TWIN_HEX.sand, font: "600 24px ui-sans-serif, system-ui, sans-serif" });
      const tex = new THREE.CanvasTexture(lbl.canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.scale.set(6.4, 1.6, 1);
      sprite.position.set(x, h + 1.4, z);
      sprite.userData = { kind: "community", slug: c.slug };
      communityGroup.add(sprite);
    }

    /* ---------------- project markers (real coordinates) ---------------- */
    const projectGroup = new THREE.Group();
    projectGroupRef.current = projectGroup;
    scene.add(projectGroup);
    const projGeo = new THREE.OctahedronGeometry(0.62);
    const projMat = new THREE.MeshStandardMaterial({ color: TWIN_HEX.gold, roughness: 0.35, metalness: 0.5, emissive: new THREE.Color(TWIN_HEX.gold), emissiveIntensity: 0.3 });
    for (const p of projects) {
      const [x, z] = project(p.lat, p.lng);
      const mesh = new THREE.Mesh(projGeo, projMat);
      mesh.position.set(x, 1.1, z);
      mesh.userData = { kind: "project", slug: p.slug };
      projectGroup.add(mesh);
    }

    /* ---------------- controls ---------------- */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 240;
    controls.maxPolarAngle = Math.PI * 0.46; // never below ground (§30)
    controls.target.copy(CAMERA_HOME.target);
    controlsRef.current = controls;

    /* ---------------- picking ---------------- */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt: { x: number; y: number } | null = null;

    const pickables = () => {
      const list: THREE.Object3D[] = [];
      if (communityGroup.visible) for (const { mesh } of columnRefs.current.values()) list.push(mesh);
      if (projectGroup.visible) for (const child of projectGroup.children) list.push(child);
      return list;
    };
    const pick = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables(), false);
      return hits.length ? hits[0].object : null;
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      const obj = pick(ev);
      const key = obj ? `${obj.userData.kind}:${obj.userData.slug}` : null;
      const x = ev.clientX - host.getBoundingClientRect().left;
      const y = ev.clientY - host.getBoundingClientRect().top;
      if (key !== hoverRef.current) {
        hoverRef.current = key;
        if (!obj) {
          setHover(null);
          return;
        }
        if (obj.userData.kind === "community") {
          const c = communitiesRef.current.find((cc) => cc.slug === obj.userData.slug);
          const metric = c?.metrics[metricKeyRef.current];
          setHover({
            kind: "community",
            name: c?.name ?? "",
            x,
            y,
            value: metric ? formatAtlasMetricValue(metricKeyRef.current, metric.value) : null,
            state: metric?.state ?? null,
          });
        } else {
          const p = projects.find((pp) => pp.slug === obj.userData.slug);
          setHover({
            kind: "project",
            name: p?.name ?? "",
            x,
            y,
            value: null,
            state: null,
          });
        }
      } else if (obj) {
        /* same target — keep the tooltip glued to the pointer */
        setHover((h) => (h ? { ...h, x, y } : h));
      }
    };
    const onPointerDown = (ev: PointerEvent) => {
      downAt = { x: ev.clientX, y: ev.clientY };
      camGoalRef.current = null; // manual interaction cancels any camera goal
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
      downAt = null;
      if (moved > 6) return; // drag, not a click
      const obj = pick(ev);
      if (!obj) {
        selectRef.current(null);
        return;
      }
      if (obj.userData.kind === "community") selectRef.current(obj.userData.slug as string);
      else selectProjectRef.current(obj.userData.slug as string);
    };
    const onLeave = () => {
      hoverRef.current = null;
      setHover(null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    /* ---------------- resize + render loop ---------------- */
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

    const tick = () => {
      const goal = camGoalRef.current;
      if (goal) {
        camera.position.lerp(goal.position, reducedMotion ? 1 : 0.07);
        controls.target.lerp(goal.target, reducedMotion ? 1 : 0.07);
        if (camera.position.distanceTo(goal.position) < 0.4) camGoalRef.current = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    const stopFrames = manageSceneFrames(host, renderer.domElement, tick, onUnavailable);

    /* ---------------- teardown (§55 — no leaks on repeat nav) ---------------- */
    return () => {
      stopFrames();
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      controlsRef.current = null;
      disposeObject3D(scene, [projGeo, projMat]);
      releaseSceneRenderer(renderer);
      columnRefs.current = new Map();
      communityGroupRef.current = null;
      projectGroupRef.current = null;
      camGoalRef.current = null;
    };
     
  }, [communities, projects, performanceMode, reducedMotion, onUnavailable]);

  /* Column styling (hover/selection) — cheap in-place material updates.
   * Three.js scene objects are imperative by design (V2 §30); the React
   * compiler immutability rule is intentionally waived for these lines. */
  const restyleColumns = () => {
    /* eslint-disable react-hooks/immutability -- imperative three.js updates */
    for (const [slug, { mesh, mat }] of columnRefs.current) {
      const metric = communities.find((c) => c.slug === slug)?.metrics[metricKeyRef.current];
      const isHover = hoverRef.current === `community:${slug}`;
      const isSelected = selectedCommunity === slug;
      if (isSelected) {
        mat.color.set(TWIN_HEX.gold);
        mat.emissive.set(TWIN_HEX.gold);
        mat.emissiveIntensity = 0.45;
        mat.opacity = 0.85;
        mesh.scale.set(1.15, mesh.scale.y, 1.15);
      } else if (isHover) {
        mat.color.set(TWIN_HEX.sienna);
        mat.emissive.set(TWIN_HEX.sienna);
        mat.emissiveIntensity = 0.3;
        mat.opacity = 0.8;
        mesh.scale.set(1.05, mesh.scale.y, 1.05);
      } else {
        mat.color.set(metric ? TWIN_HEX.bronze : TWIN_HEX.inkNeutral);
        mat.emissive.set(TWIN_HEX.bronze);
        mat.emissiveIntensity = 0.1;
        mat.opacity = metric ? 0.55 : 0.22;
        mesh.scale.set(0.95, mesh.scale.y, 0.95);
      }
    }
    /* eslint-enable react-hooks/immutability */
  };
  React.useEffect(() => {
    restyleColumns();
  }, [selectedCommunity, metricKey, communities]);

  /* metricKey changes update columns in place — no scene rebuild. */
  React.useEffect(() => {
    metricKeyRef.current = metricKey;

    const values = communities.map((c) => c.metrics[metricKey]?.value ?? null).filter((v): v is number => v !== null);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    for (const c of communities) {
      const entry = columnRefs.current.get(c.slug);
      if (!entry) continue;
      const metric = c.metrics[metricKey];
      const norm = metric && max > min ? (metric.value - min) / (max - min) : 0;
      const h = metric ? 2 + norm * 11 : 0.7;
      entry.mesh.scale.set(0.95, h, 0.95);
      entry.mesh.position.y = h / 2;
      /* keep the name sprite above the column */
      const sprite = communityGroupRef.current?.children.find(
        (ch) => ch instanceof THREE.Sprite && ch.userData.slug === c.slug
      );
      if (sprite) sprite.position.y = h + 1.4;
    }
    restyleColumns();
  }, [metricKey, communities, selectedCommunity]);  


  /* Layer visibility toggles. */
  React.useEffect(() => {
    if (communityGroupRef.current) communityGroupRef.current.visible = layers.communities;
    if (projectGroupRef.current) projectGroupRef.current.visible = layers.projects;
  }, [layers.communities, layers.projects]);

  /* Reset signal → camera home (animated unless reduced-motion). */
  React.useEffect(() => {
    if (resetSignal === 0) return;
    if (reducedMotion) {
      const controls = controlsRef.current;
      if (controls) {
        controls.object.position.copy(CAMERA_HOME.position);
        controls.target.copy(CAMERA_HOME.target);
        controls.update();
      }
    } else {
      camGoalRef.current = { position: CAMERA_HOME.position.clone(), target: CAMERA_HOME.target.clone() };
    }
  }, [resetSignal, reducedMotion]);

  /* flyTo → camera goal above the community column. */
  React.useEffect(() => {
    if (!flyTo) return;
    const c = communities.find((cc) => cc.slug === flyTo);
    if (!c) return;
    const [x, z] = project(c.lat, c.lng);
    const goal = {
      position: new THREE.Vector3(x + 10, 26, z + 22),
      target: new THREE.Vector3(x, 4, z),
    };
    if (reducedMotion) {
      const controls = controlsRef.current;
      if (controls) {
        controls.object.position.copy(goal.position);
        controls.target.copy(goal.target);
        controls.update();
      }
    } else {
      camGoalRef.current = goal;
    }
  }, [flyTo, communities, reducedMotion]);

  return (
    /* §16.2/§18 — absolute inset-0 for the same definite-height reason as the
       2D map (column-flex viewport at mobile widths is not a definite
       percentage height). Stays a positioned containing block for the
       overlay labels/legend below. */
    <div className="absolute inset-0">
      <div ref={hostRef} data-scene-host="atlas" className="h-full w-full" role="img" aria-label={t("atlas.sr.scene", locale)} />
      <span className="sr-only">{t("atlas.sr.3doff", locale)}</span>

      {/* hover tooltip — HTML overlay with data-state badge (§37) */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[16rem] -translate-y-full rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg"
          style={{ left: Math.max(8, hover.x), top: Math.max(34, hover.y - 10) }}
        >
          <p className="text-sm font-semibold leading-tight">{hover.name}</p>
          {hover.kind === "community" ? (
            <p className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {hover.value ?? t("map.layers.unavailable", locale)}
              {hover.state && <DataStateBadge state={hover.state} />}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">{t("atlas.project.marker", locale)}</p>
          )}
        </div>
      )}

      {/* simplified-representation note (§31 labelling) */}
      <p className="pointer-events-none absolute bottom-3 start-3 max-w-[19rem] rounded-lg bg-[#16130f]/80 px-3 py-2 text-[11px] leading-snug text-[#e2d8c4]/85 backdrop-blur-sm">
        {t("atlas.note.3d", locale)}
      </p>
      <p className="pointer-events-none absolute end-3 top-3 rounded-lg bg-[#16130f]/80 px-3 py-1.5 text-[11px] text-[#e2d8c4]/85 backdrop-blur-sm">
        {t("atlas.legend.height", locale)} · {formatNumber(projects.length)} {t("atlas.project.marker", locale)}
      </p>
    </div>
  );
}

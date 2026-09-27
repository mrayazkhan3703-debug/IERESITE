"use client";

/**
 * Project massing — 3D digital-twin block (U18, V2 §31).
 *
 * Procedural, clearly-labelled simplified massing: podium + tower (or a
 * low-rise villa row when no upper floors are recorded), an orientation
 * compass and an illustrative sun direction. Source CAD/BIM/GLB data is not
 * available in this environment, so per §31 this is a *simplified clearly
 * labelled representation*, never presented as developer geometry.
 *
 * This module is loaded exclusively through React.lazy — it statically
 * imports three (route-split 3D chunk, §30.3/§42). Unmount disposal runs the
 * full §55 teardown (renderer, geometries, materials, textures, controls).
 */

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TWIN_HEX, clampedPixelRatio, disposeObject3D, makeLabelCanvas } from "@/components/twin/three-utils";
import { manageSceneFrames, releaseSceneRenderer } from "@/components/twin/scene-lifecycle";

export interface ProjectMassingProps {
  /** Tallest recorded floor (null → low-rise / villa massing). */
  maxFloor: number | null;
  /** Recorded unit count (drives villa-row length). */
  unitCount: number;
  performanceMode?: boolean;
  onError?: () => void;
}

export default function ProjectMassing({ maxFloor, unitCount, performanceMode = false, onError }: ProjectMassingProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !performanceMode, alpha: false });
    } catch (err) {
      console.error("[massing] WebGL renderer creation failed", err);
      onError?.();
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(TWIN_HEX.sceneBg);
    scene.fog = new THREE.Fog(TWIN_HEX.sceneBg, 60, 140);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    camera.position.set(16, 12, 20);

    renderer.setPixelRatio(clampedPixelRatio(performanceMode));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true"); // decorative canvas — HTML carries the info

    /* ---------------- lights ---------------- */
    scene.add(new THREE.AmbientLight(0xf3e6cf, 0.55));
    const sun = new THREE.DirectionalLight(0xf0d9a8, 1.05);
    sun.position.set(24, 26, -14); // illustrative morning sun (NE-high)
    scene.add(sun);

    /* ---------------- ground + grid ---------------- */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: TWIN_HEX.land, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 30, 0x5a4630, 0x332a1f);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    /* ---------------- massing blocks (simplified, illustrative) ---------------- */
    const massingGroup = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({
      color: TWIN_HEX.bronze,
      transparent: true,
      opacity: 0.42,
      roughness: 0.55,
      metalness: 0.25,
      depthWrite: false,
    });
    const podiumMat = new THREE.MeshStandardMaterial({
      color: TWIN_HEX.sienna,
      transparent: true,
      opacity: 0.5,
      roughness: 0.7,
      metalness: 0.1,
      depthWrite: false,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: TWIN_HEX.gold, transparent: true, opacity: 0.85 });

    const addBlock = (w: number, h: number, d: number, x: number, z: number, mat: THREE.Material) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, h / 2, z);
      massingGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      edges.position.copy(mesh.position);
      massingGroup.add(edges);
    };

    const highRise = (maxFloor ?? 0) >= 3;
    if (highRise) {
      /* tower height tracks the tallest recorded floor (illustrative scale) */
      const towerH = Math.max(8, Math.min(30, (maxFloor ?? 10) * 0.62));
      addBlock(11, 1.8, 7.5, 0, 1.5, podiumMat); // podium
      addBlock(4.2, towerH, 4.2, -1.2, -0.5, towerMat); // tower
      addBlock(2.8, towerH * 0.55, 2.8, 3.4, -1.2, towerMat); // secondary wing
    } else {
      /* low-rise / villa row — length tracks the recorded unit count */
      const count = Math.max(3, Math.min(12, unitCount));
      for (let i = 0; i < count; i++) {
        addBlock(2.1, 2.1, 2.6, (i - (count - 1) / 2) * 2.9, 0, i % 3 === 1 ? podiumMat : towerMat);
      }
    }
    scene.add(massingGroup);

    /* ---------------- orientation compass ---------------- */
    const compass = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(8.6, 9, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: TWIN_HEX.sand, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    compass.add(ring);
    /* needle pointing north (−Z) */
    const needleGeo = new THREE.ConeGeometry(0.55, 2.4, 4);
    const needleMat = new THREE.MeshBasicMaterial({ color: TWIN_HEX.gold });
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.rotation.x = -Math.PI / 2;
    needle.position.set(0, 0.12, -9.6);
    compass.add(needle);
    /* N sprite */
    const nLabel = makeLabelCanvas("N", { color: TWIN_HEX.gold, font: "700 34px ui-sans-serif, system-ui, sans-serif", width: 64, height: 64 });
    const nTex = new THREE.CanvasTexture(nLabel.canvas);
    const nSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nTex, transparent: true }));
    nSprite.scale.set(1.8, 1.8, 1);
    nSprite.position.set(0, 0.9, -11.4);
    compass.add(nSprite);
    scene.add(compass);

    /* ---------------- illustrative sun marker ---------------- */
    const sunGeo = new THREE.SphereGeometry(1.1, 20, 14);
    const sunMat = new THREE.MeshBasicMaterial({ color: TWIN_HEX.gold });
    const sunBall = new THREE.Mesh(sunGeo, sunMat);
    sunBall.position.set(24, 26, -14);
    scene.add(sunBall);
    const sunLabel = makeLabelCanvas("☀", { color: TWIN_HEX.gold, width: 64, height: 64, font: "400 34px ui-sans-serif, system-ui, sans-serif" });
    const sunTex = new THREE.CanvasTexture(sunLabel.canvas);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true }));
    sunSprite.scale.set(2.4, 2.4, 1);
    sunSprite.position.set(24, 28.6, -14);
    scene.add(sunSprite);

    /* ---------------- controls ---------------- */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 10;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI * 0.47; // never below the ground plane
    controls.target.set(0, highRise ? 6 : 1.5, 0);

    /* ---------------- resize ---------------- */
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    /* ---------------- render loop ---------------- */
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    const stopFrames = manageSceneFrames(container, renderer.domElement, tick, onError);

    /* ---------------- teardown (§55 — no leaks on repeat navigation) ------- */
    return () => {
      stopFrames();
      ro.disconnect();
      controls.dispose();
      disposeObject3D(scene);
      releaseSceneRenderer(renderer);
    };
  }, [maxFloor, unitCount, performanceMode, onError]);

  return <div ref={containerRef} data-scene-host="massing" className="h-64 w-full sm:h-72" />;
}

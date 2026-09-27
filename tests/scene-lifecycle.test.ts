import { expect, test } from "bun:test";
import { createSceneFrameLoop, releaseSceneRenderer } from "../src/components/twin/scene-lifecycle";
import { disposeObject3D, probeWebGLCanvas } from "../src/components/twin/three-utils";
import { mapMarkerIdentity } from "../src/lib/map-marker-identity";

test("scene loop pauses, resumes one owner and ignores late cancelled callbacks", () => {
  let sequence = 0;
  let renders = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const loop = createSceneFrameLoop(() => renders++, (cb) => { callbacks.set(++sequence, cb); return sequence; },
    (id) => { cancelled.push(id); callbacks.delete(id); });
  expect(callbacks.size).toBe(0);
  loop.setVisible(true); loop.setVisible(true);
  expect(callbacks.size).toBe(1);
  const [first, callback] = [...callbacks][0];
  callbacks.delete(first); callback(0);
  expect(renders).toBe(1);
  expect(callbacks.size).toBe(1);
  const stale = [...callbacks.values()][0];
  loop.setVisible(false);
  expect(callbacks.size).toBe(0);
  loop.setVisible(true);
  stale(0);
  expect(renders).toBe(1);
  expect(callbacks.size).toBe(1);
  loop.dispose(); loop.dispose(); loop.setVisible(true); stale(0);
  expect(callbacks.size).toBe(0);
  expect(renders).toBe(1);
  expect(cancelled).toHaveLength(2);
});

test("scene loop does not reschedule if disposed during rendering", () => {
  let callback: FrameRequestCallback | undefined;
  let requests = 0;
  const loop = createSceneFrameLoop(() => loop.dispose(), (cb) => { callback = cb; return ++requests; }, () => {});
  loop.setVisible(true); callback?.(0);
  expect(requests).toBe(1);
});

test("scene disposal deduplicates shared resources and releases detached palettes", () => {
  const calls: string[] = [];
  const resource = (name: string) => ({ dispose() { calls.push(name); } });
  const texture = { ...resource("texture"), isTexture: true };
  const normal = { ...resource("normal"), isTexture: true };
  const geometry = resource("geometry");
  const material = { ...resource("material"), map: texture, normalMap: normal };
  const detached = { ...resource("detached"), map: texture };
  const nodes = [{ geometry, material }, { geometry, material: [material, detached] }, { material: null }];
  disposeObject3D({ traverse(cb) { nodes.forEach(cb); } }, [material, detached, resource("unused")]);
  expect(calls).toEqual(["geometry", "texture", "normal", "material", "detached", "unused"]);
});

test("renderer cleanup releases context and DOM even if disposal throws", () => {
  const calls: string[] = [];
  expect(() => releaseSceneRenderer({
    dispose() { calls.push("dispose"); throw new Error("synthetic disposal failure"); },
    forceContextLoss() { calls.push("context"); }, domElement: { remove() { calls.push("remove"); } },
  })).toThrow("synthetic disposal failure");
  expect(calls).toEqual(["dispose", "context", "remove"]);
});

test("capability probe requires WebGL2 and releases its temporary context", () => {
  const contexts: string[] = [];
  let releases = 0;
  const canvas = { getContext(kind: string) {
    contexts.push(kind);
    return { getExtension(name: string) { expect(name).toBe("WEBGL_lose_context"); return { loseContext() { releases++; } }; } };
  } } as unknown as Pick<HTMLCanvasElement, "getContext">;
  expect(probeWebGLCanvas(canvas)).toBe(true);
  expect(contexts).toEqual(["webgl2"]);
  expect(releases).toBe(1);
  expect(probeWebGLCanvas({ getContext: () => null } as Pick<HTMLCanvasElement, "getContext">)).toBe(false);
});

test("marker callback identity changes with destination and tooltip, not object allocation", () => {
  const marker = { lat: 25, lng: 55, label: "Synthetic marker", kind: "project", href: "/projects/synthetic", sublabel: "Synthetic state" };
  const key = mapMarkerIdentity([marker]);
  expect(mapMarkerIdentity([{ ...marker }])).toBe(key);
  expect(mapMarkerIdentity([{ ...marker, href: "/projects/other-synthetic" }])).not.toBe(key);
  expect(mapMarkerIdentity([{ ...marker, sublabel: "Other synthetic state" }])).not.toBe(key);
});

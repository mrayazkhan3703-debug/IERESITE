/** Client scene ownership helpers; no React/Three import in non-lazy hosts. */
export function createSceneFrameLoop(
  render: () => void,
  request: (callback: FrameRequestCallback) => number = (callback) => requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let pending: number | null = null;
  let visible = false;
  let disposed = false;
  let generation = 0;
  const schedule = () => {
    const owner = generation;
    pending = request(() => {
      if (owner !== generation || disposed || !visible) return;
      pending = null;
      render();
      if (owner === generation && !disposed && visible && pending === null) schedule();
    });
  };
  return {
    setVisible(next: boolean) {
      if (disposed) return;
      visible = next;
      if (!visible) {
        generation++;
        if (pending !== null) cancel(pending);
        pending = null;
      } else if (pending === null) schedule();
    },
    dispose() {
      disposed = true;
      generation++;
      if (pending !== null) cancel(pending);
      pending = null;
    },
  };
}

/** Pause work offscreen/in hidden tabs; lost/failed contexts use host fallback. */
export function manageSceneFrames(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  render: () => void,
  onUnavailable?: () => void,
): () => void {
  let failed = false;
  let disposed = false;
  let inViewport = typeof IntersectionObserver === "undefined";
  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    loop.setVisible(false);
    onUnavailable?.();
  };
  const loop = createSceneFrameLoop(() => {
    try { render(); } catch { fail(); }
  });
  const synchronize = () => loop.setVisible(!document.hidden && inViewport && !failed);
  const contextLost = (event: Event) => { event.preventDefault(); fail(); };
  document.addEventListener("visibilitychange", synchronize);
  canvas.addEventListener("webglcontextlost", contextLost);
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    if (disposed) return;
    inViewport = entries.some((entry) => entry.target === host && entry.isIntersecting);
    synchronize();
  });
  observer?.observe(host);
  synchronize();
  return () => {
    disposed = true;
    loop.dispose();
    observer?.disconnect();
    document.removeEventListener("visibilitychange", synchronize);
    canvas.removeEventListener("webglcontextlost", contextLost);
  };
}

/** Call after listeners/controls/scene resources are released. */
export function releaseSceneRenderer(renderer: {
  dispose: () => void;
  forceContextLoss: () => void;
  domElement: { remove: () => void };
}) {
  try { renderer.dispose(); }
  finally {
    try { renderer.forceContextLoss(); }
    finally { renderer.domElement.remove(); }
  }
}

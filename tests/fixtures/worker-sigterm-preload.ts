import { mock } from "bun:test";
import { resolve } from "node:path";

// Loaded only by the subprocess integration test, never by the normal worker.
if (process.env.NODE_ENV !== "test" || !["block", "recover"].includes(process.env.WORKER_SIGTERM_FIXTURE ?? "")) {
  throw new Error("The SIGTERM fixture requires an explicitly isolated test worker.");
}

mock.module(resolve(import.meta.dir, "../../src/server/alerts/matcher.ts"), () => ({
  matchSavedSearches: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    console.log("fixture.handler.started");
    if (process.env.WORKER_SIGTERM_FIXTURE === "block") {
      await new Promise<void>((done) => {
        signal.addEventListener("abort", () => {
          console.log("fixture.handler.aborted");
          // Keep the handler alive briefly to prove shutdown awaits cleanup.
          setTimeout(done, 100);
        }, { once: true });
        if (signal.aborted) done();
      });
      console.log("fixture.handler.cleaned");
    } else {
      console.log("fixture.handler.recovered");
    }
  },
}));

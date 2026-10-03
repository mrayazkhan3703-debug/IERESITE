import { getConfig } from "@/lib/config";
import { HttpError } from "@/server/auth";
import { JobDeferredError } from "@/server/jobs/deferred";

/** Brief cutover pause. Reads and entity selections remain available. */
export function requireStorageWrites(paused = getConfig().STORAGE_MUTATIONS_PAUSED) {
  if (paused) throw new HttpError(503, "Media uploads and deletion are temporarily paused for storage maintenance. Keep this form open and retry shortly.", "STORAGE_MUTATIONS_PAUSED");
}

/** Maintenance must not exhaust durable jobs' failure attempts. */
export function storageWriteDeferral(error: unknown): JobDeferredError | null {
  return error instanceof HttpError && error.status === 503 && error.code === "STORAGE_MUTATIONS_PAUSED"
    ? new JobDeferredError("STORAGE_MUTATIONS_PAUSED", 30_000) : null;
}

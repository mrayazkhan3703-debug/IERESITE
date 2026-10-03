import { getConfig } from "@/lib/config";
import { HttpError } from "@/server/auth";

/** Brief cutover pause. Reads and entity selections remain available. */
export function requireStorageWrites(paused = getConfig().STORAGE_MUTATIONS_PAUSED) {
  if (paused) throw new HttpError(503, "Media uploads and deletion are temporarily paused for storage maintenance. Keep this form open and retry shortly.", "STORAGE_MUTATIONS_PAUSED");
}

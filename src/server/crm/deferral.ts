import { getConfig } from "@/lib/config";
import { HttpError } from "@/server/auth";
export function externalCrmDeferred(config: Pick<ReturnType<typeof getConfig>, "CRM_SYNC_DEFERRED" | "CRM_LIVE_ENABLED"> = getConfig()): boolean {
  return config.CRM_SYNC_DEFERRED || !config.CRM_LIVE_ENABLED;
}
export function crmDeliveryDeferred(config: Pick<ReturnType<typeof getConfig>, "CRM_SYNC_DEFERRED" | "CRM_LIVE_ENABLED" | "CRM_PROVIDER" | "APP_ENV"> = getConfig()): boolean {
  // Simulated delivery is only acceptance evidence inside local development.
  return config.CRM_PROVIDER === "localdev" ? config.APP_ENV !== "development" : externalCrmDeferred(config);
}
export function requireExternalCrmEnabled() {
  if (externalCrmDeferred()) throw new HttpError(409, "External CRM synchronization is deferred. Local leads and pending work are retained.", "CRM_SYNC_DEFERRED");
}

import { requirePermission, HttpError } from "@/server/auth";
import { isPrivilegedGhlAdmin } from "@/server/crm/ghl-oauth";

export async function requireGhlAdmin() {
  const actor = await requirePermission("integration:read");
  if (!isPrivilegedGhlAdmin(actor)) {
    throw new HttpError(403, "Only an owner or admin can manage the GHL integration.", "GHL_OAUTH_FORBIDDEN");
  }
  return actor;
}

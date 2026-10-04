import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/server/auth";
import { HttpError } from "@/server/auth";
import { canCreateCatalogResource } from "./resource-policy";

export function companyImportSource(actor: SessionUser) {
  if (!canCreateCatalogResource(actor)) throw new HttpError(403, "An authorized company administrator is required.", "IMPORT_SCOPE_FORBIDDEN");
  const identity = actor.organizationId ? `organization:${actor.organizationId}` : `owner:${actor.id}`;
  return { name: `INTERACTIVE_UPLOAD_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`, ownerOrganizationId: actor.organizationId };
}

export function importRunReadFilter(actor: SessionUser): Prisma.ImportRunWhereInput {
  if (actor.roles.includes("OWNER")) return {};
  return actor.organizationId ? { importSource: { ownerOrganizationId: actor.organizationId } } : { id: { in: [] } };
}

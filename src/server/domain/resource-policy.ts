import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/server/auth";

const NO_LEADS: Prisma.LeadWhereInput = { id: { in: [] } };
const NO_AGENTS: Prisma.AgentWhereInput = { id: { in: [] } };

function hasAnyRole(user: SessionUser, roles: readonly string[]): boolean {
  return user.roles.some((role) => roles.includes(role));
}

export type CatalogResourceScope =
  | { kind: "global" }
  | { kind: "organization"; organizationId: string }
  | { kind: "none" };

/** Shared source rows remain visible to org staff as read-only references. */
export function catalogResourceScope(user: SessionUser): CatalogResourceScope {
  if (user.roles.includes("OWNER")) return { kind: "global" };
  if (hasAnyRole(user, ["ADMIN", "MANAGER"]) && user.organizationId) {
    return { kind: "organization", organizationId: user.organizationId };
  }
  return { kind: "none" };
}

export function catalogReadFilter(user: SessionUser) {
  const scope = catalogResourceScope(user);
  if (scope.kind === "global") return {};
  if (scope.kind === "organization") return { OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: scope.organizationId }] };
  return { id: { in: [] as string[] } };
}

export function canManageCatalogResource(user: SessionUser, ownerOrganizationId: string | null): boolean {
  if (user.roles.includes("OWNER")) return true;
  return hasAnyRole(user, ["ADMIN", "MANAGER"]) && Boolean(user.organizationId) && user.organizationId === ownerOrganizationId;
}

export function canCreateCatalogResource(user: SessionUser): boolean {
  return user.roles.includes("OWNER") || (hasAnyRole(user, ["ADMIN", "MANAGER"]) && Boolean(user.organizationId));
}

/** Organization boundary for anonymized lead aggregates. */
export function leadAggregateScope(user: SessionUser): Prisma.LeadWhereInput {
  if (user.roles.includes("OWNER")) return {};
  if (!hasAnyRole(user, ["ADMIN", "MANAGER", "AGENT", "ANALYST"])) return NO_LEADS;
  return user.organizationId ? { organizationId: user.organizationId } : NO_LEADS;
}

/** Row-level scope for lead records containing contact PII. */
export function leadRecordScope(user: SessionUser): Prisma.LeadWhereInput {
  if (user.roles.includes("OWNER")) return {};
  if (hasAnyRole(user, ["ADMIN", "MANAGER"])) return leadAggregateScope(user);
  if (user.roles.includes("AGENT")) {
    return {
      AND: [
        leadAggregateScope(user),
        { ownerAgent: { is: { userId: user.id } } },
      ],
    };
  }
  return NO_LEADS;
}

export function scopedLeadWhere(
  user: SessionUser,
  requested: Prisma.LeadWhereInput = {},
): Prisma.LeadWhereInput {
  return { AND: [leadRecordScope(user), requested] };
}

/** Profile rows are global only for the global owner; staff is tenant-scoped. */
export function agentProfileScope(user: SessionUser): Prisma.AgentWhereInput {
  if (user.roles.includes("OWNER")) return {};
  if (hasAnyRole(user, ["ADMIN", "MANAGER"])) {
    return user.organizationId ? { OR: [{ ownerOrganizationId: user.organizationId }, { ownerOrganizationId: null, user: { is: { organizationId: user.organizationId } } }] } : NO_AGENTS;
  }
  if (user.roles.includes("CONTENT_EDITOR")) return { publicAdvisor: true };
  return NO_AGENTS;
}

export function canManageAgentProfile(user: SessionUser, agentOrganizationId: string | null): boolean {
  if (user.roles.includes("OWNER")) return true;
  return hasAnyRole(user, ["ADMIN", "MANAGER"]) && Boolean(user.organizationId) && user.organizationId === agentOrganizationId;
}

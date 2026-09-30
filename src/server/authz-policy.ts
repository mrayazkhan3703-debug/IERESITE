/**
 * Canonical role-to-permission bootstrap policy.
 *
 * Runtime authorization uses grants loaded from PostgreSQL. This manifest is
 * only the deterministic source used by migrations, development seeding, and
 * policy tests; changing it requires a matching migration.
 */
export const ROLE_PERMISSION_MANIFEST = {
  OWNER: ["*"],
  ADMIN: [
    "property:*", "project:*", "developer:*", "community:*", "agent:*",
    "lead:*", "content:*", "media:*", "seo:*", "import:*", "user:read", "user:invite", "user:update", "audit:read",
    "analytics:read", "integration:read", "rag:*", "market:*", "jobs:*", "dlq:*", "quality:*", "site-settings:update",
  ],
  MANAGER: [
    "property:*", "project:*", "developer:*", "community:*", "agent:*",
    "lead:*", "content:read", "media:read", "import:read", "audit:read",
    "analytics:read", "integration:read", "market:read", "jobs:read", "quality:read",
  ],
  CONTENT_EDITOR: [
    "content:*", "media:*", "seo:*", "rag:*", "market:*",
    "property:read", "project:read", "community:read", "developer:read", "agent:read",
  ],
  AGENT: ["lead:read", "lead:update", "property:read", "project:read", "viewing:*", "booking:read"],
  // Analysts receive aggregate/quality surfaces, never raw lead PII.
  ANALYST: ["analytics:read", "market:*", "property:read", "quality:read"],
  CUSTOMER: ["account:self"],
  // Retained for backwards compatibility with existing read-only staff users.
  VIEWER: ["property:read", "project:read", "content:read", "market:read"],
} as const satisfies Record<string, readonly string[]>;

export type RoleKey = keyof typeof ROLE_PERMISSION_MANIFEST;

export function permissionMatches(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  if (!granted.endsWith(":*")) return false;
  return required.startsWith(granted.slice(0, -1));
}

export function hasGrantedPermission(grants: readonly string[], required: string): boolean {
  return grants.some((grant) => permissionMatches(grant, required));
}

export function permissionsForRoles(roles: readonly string[]): string[] {
  const permissions = new Set<string>();
  for (const role of roles) {
    const configured = ROLE_PERMISSION_MANIFEST[role as RoleKey] ?? [];
    for (const permission of configured) permissions.add(permission);
  }
  return [...permissions];
}

export function hasPermission(roles: readonly string[], required: string): boolean {
  return hasGrantedPermission(permissionsForRoles(roles), required);
}

import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@/server/auth";
import { agentProfileScope, canCreateCatalogResource, canManageAgentProfile, canManageCatalogResource, catalogReadFilter, catalogResourceScope, leadAggregateScope, leadRecordScope, scopedLeadWhere } from "@/server/domain/resource-policy";

function user(roles: string[], organizationId: string | null = "org-1"): SessionUser {
  return { sessionId: "session-1", id: "user-1", email: "user@example.invalid", name: null, roles, organizationId, permissions: [], mfaVerified: true };
}

describe("lead resource policy", () => {
  test("owners are global while managers are organization-bound", () => {
    expect(leadRecordScope(user(["OWNER"], null))).toEqual({});
    expect(leadRecordScope(user(["MANAGER"]))).toEqual({ organizationId: "org-1" });
    expect(leadRecordScope(user(["MANAGER"], null))).toEqual({ id: { in: [] } });
  });

  test("agents can only access leads assigned to their linked agent record", () => {
    expect(leadRecordScope(user(["AGENT"]))).toEqual({
      AND: [
        { organizationId: "org-1" },
        { ownerAgent: { is: { userId: "user-1" } } },
      ],
    });
  });

  test("analysts receive aggregates but never lead PII records", () => {
    const analyst = user(["ANALYST"]);
    expect(leadAggregateScope(analyst)).toEqual({ organizationId: "org-1" });
    expect(leadRecordScope(analyst)).toEqual({ id: { in: [] } });
    expect(scopedLeadWhere(analyst, { status: "NEW" })).toEqual({
      AND: [{ id: { in: [] } }, { status: "NEW" }],
    });
  });
});

describe("agent profile resource policy", () => {
  test("owners are global; organization staff are scoped through linked users", () => {
    expect(agentProfileScope(user(["OWNER"], null))).toEqual({});
    expect(agentProfileScope(user(["MANAGER"]))).toEqual({ user: { is: { organizationId: "org-1" } } });
    expect(agentProfileScope(user(["ADMIN"], null))).toEqual({ id: { in: [] } });
  });

  test("content editors see public advisor profiles only", () => {
    expect(agentProfileScope(user(["CONTENT_EDITOR"]))).toEqual({ publicAdvisor: true });
    expect(agentProfileScope(user(["AGENT"]))).toEqual({ id: { in: [] } });
  });

  test("updates require global owner or matching organization membership", () => {
    expect(canManageAgentProfile(user(["OWNER"], null), null)).toBe(true);
    expect(canManageAgentProfile(user(["MANAGER"]), "org-1")).toBe(true);
    expect(canManageAgentProfile(user(["MANAGER"]), "org-2")).toBe(false);
    expect(canManageAgentProfile(user(["ADMIN"], null), "org-1")).toBe(false);
  });
});

describe("catalog resource ownership policy", () => {
  test("owners are global, staff see the shared catalog plus their own organization, and unscoped users see none", () => {
    expect(catalogResourceScope(user(["OWNER"], null))).toEqual({ kind: "global" });
    expect(catalogResourceScope(user(["ADMIN"], "org-1"))).toEqual({ kind: "organization", organizationId: "org-1" });
    expect(catalogResourceScope(user(["MANAGER"], null))).toEqual({ kind: "none" });
    expect(catalogResourceScope(user(["AGENT"]))).toEqual({ kind: "none" });
    expect(catalogReadFilter(user(["OWNER"], null))).toEqual({});
    expect(catalogReadFilter(user(["ADMIN"], "org-1"))).toEqual({ OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: "org-1" }] });
    expect(catalogReadFilter(user(["MANAGER"], null))).toEqual({ id: { in: [] } });
  });

  test("shared rows are not editable by staff, and creates require an organization", () => {
    expect(canManageCatalogResource(user(["OWNER"], null), null)).toBe(true);
    expect(canManageCatalogResource(user(["ADMIN"], "org-1"), "org-1")).toBe(true);
    expect(canManageCatalogResource(user(["ADMIN"], "org-1"), "org-2")).toBe(false);
    expect(canManageCatalogResource(user(["ADMIN"], "org-1"), null)).toBe(false);
    expect(canCreateCatalogResource(user(["OWNER"], null))).toBe(true);
    expect(canCreateCatalogResource(user(["ADMIN"], "org-1"))).toBe(true);
    expect(canCreateCatalogResource(user(["ADMIN"], null))).toBe(false);
  });
});

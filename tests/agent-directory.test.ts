import { describe, expect, test } from "bun:test";
import { assignableAdvisorWhere, peopleAdminWhere, peopleFilter } from "@/server/domain/agent-directory";
import { PUBLIC_AGENT_WHERE } from "@/server/domain/visibility";
import type { SessionUser } from "@/server/auth";

const actor: SessionUser = { id: "staff", sessionId: "session", email: "staff@example.invalid", name: "Test", roles: ["ADMIN"], permissions: [], organizationId: "organization", mfaVerified: true };
describe("unified people directory and assignment policy", () => {
  test("assignment combines organization, public eligibility and exact submitted ID", () => {
    const where = assignableAdvisorWhere(actor, "advisor");
    expect(where.AND).toEqual([
      { OR: [{ ownerOrganizationId: "organization" }, { ownerOrganizationId: null, user: { is: { organizationId: "organization" } } }] },
      PUBLIC_AGENT_WHERE, { id: "advisor" },
    ]);
    expect(assignableAdvisorWhere({ ...actor, organizationId: null }).AND).toContainEqual({ id: { in: [] } });
    expect(assignableAdvisorWhere({ ...actor, roles: ["OWNER"] }).AND).toContainEqual({});
  });
  test("filters are bounded and staff search covers canonical profile fields", () => {
    expect(peopleFilter("advisors")).toBe("advisors");
    expect(peopleFilter("__proto__")).toBe("all");
    const where = peopleAdminWhere(actor, "x".repeat(500), "sales");
    expect(where.AND).toContainEqual({ department: "sales" });
    expect(JSON.stringify(where)).toContain('"jobTitle"');
    expect(JSON.stringify(where)).toContain('"email"');
    expect(JSON.stringify(where)).not.toContain("x".repeat(201));
    expect(peopleAdminWhere(actor, "", "advisors").AND).toContainEqual(PUBLIC_AGENT_WHERE);
    expect(peopleAdminWhere(actor, "", "team").AND).toContainEqual({ NOT: PUBLIC_AGENT_WHERE });
    expect(peopleAdminWhere(actor, "", "inactive").AND).toContainEqual({ active: false });
  });
});

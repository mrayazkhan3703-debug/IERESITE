import { describe, expect, test } from "bun:test";
import {
  hasGrantedPermission,
  hasPermission,
  permissionMatches,
  permissionsForRoles,
} from "@/server/authz-policy";

describe("authorization policy", () => {
  test("wildcards are constrained to their permission domain", () => {
    expect(permissionMatches("*", "anything:write")).toBe(true);
    expect(permissionMatches("property:*", "property:publish")).toBe(true);
    expect(permissionMatches("property:*", "propertyish:publish")).toBe(false);
    expect(hasGrantedPermission(["lead:read"], "lead:update")).toBe(false);
  });

  test("customer and analyst roles cannot access privileged or lead-PII surfaces", () => {
    expect(hasPermission(["CUSTOMER"], "account:self")).toBe(true);
    expect(hasPermission(["CUSTOMER"], "property:update")).toBe(false);
    expect(hasPermission(["ANALYST"], "analytics:read")).toBe(true);
    expect(hasPermission(["ANALYST"], "lead:read")).toBe(false);
  });

  test("manager and owner policy remains explicit and deterministic", () => {
    expect(hasPermission(["MANAGER"], "lead:update")).toBe(true);
    expect(hasPermission(["MANAGER"], "user:read")).toBe(false);
    expect(hasPermission(["OWNER"], "unlisted:operation")).toBe(true);
    expect(permissionsForRoles(["CUSTOMER"])).toEqual(["account:self"]);
  });

  test("only Owner and Admin can manage staff; Admin cannot grant privilege beyond its own tier", () => {
    expect(hasPermission(["ADMIN"], "user:read")).toBe(true);
    expect(hasPermission(["ADMIN"], "user:invite")).toBe(true);
    expect(hasPermission(["ADMIN"], "user:update")).toBe(true);
    expect(hasPermission(["MANAGER"], "user:invite")).toBe(false);
    expect(hasPermission(["CONTENT_EDITOR"], "user:update")).toBe(false);
  });
});

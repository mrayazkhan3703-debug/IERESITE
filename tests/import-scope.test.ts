import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@/server/auth";
import { companyImportSource, importRunReadFilter } from "@/server/domain/import-scope";

const actor = (id: string, organizationId: string | null, roles = ["ADMIN"]): SessionUser => ({ id, organizationId, roles, email: `${id}@example.invalid`, sessionId: "test", name: null, permissions: [], mfaVerified: true });

describe("company import source ownership", () => {
  test("company administrators share a source, other companies and global owners do not", () => {
    const first = companyImportSource(actor("a", "one"));
    expect(first).toEqual(companyImportSource(actor("b", "one")));
    expect(first.ownerOrganizationId).toBe("one");
    expect(first.name).not.toBe(companyImportSource(actor("a", "two")).name);
    expect(companyImportSource(actor("a", null, ["OWNER"])).name).not.toBe(companyImportSource(actor("b", null, ["OWNER"])).name);
  });
  test("unscoped staff cannot create an import source or read another company's history", () => {
    expect(() => companyImportSource(actor("a", null))).toThrow();
    expect(() => companyImportSource(actor("a", "one", ["AGENT"]))).toThrow();
    expect(importRunReadFilter(actor("a", "one"))).toEqual({ importSource: { ownerOrganizationId: "one" } });
    expect(importRunReadFilter(actor("a", null))).toEqual({ id: { in: [] } });
    expect(importRunReadFilter(actor("a", null, ["OWNER"]))).toEqual({});
  });
});

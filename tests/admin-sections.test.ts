import { describe, expect, test } from "bun:test";
import { adminSectionFromLocation, canViewAdminSection } from "../src/features/admin/admin-sections";

describe("Admin section routing and navigation visibility", () => {
  test("accepts canonical paths and legacy section query links", () => {
    expect(adminSectionFromLocation("/admin/communities")).toBe("communities");
    expect(adminSectionFromLocation("/admin", "content")).toBe("content");
    expect(adminSectionFromLocation("/admin/unknown", "content")).toBe("overview");
  });

  test("filters visible links by role while leaving API authorization authoritative", () => {
    expect(canViewAdminSection("content", ["CONTENT_EDITOR"])).toBe(true);
    expect(canViewAdminSection("users", ["CONTENT_EDITOR"])).toBe(false);
    expect(canViewAdminSection("analytics", ["ANALYST"])).toBe(true);
    expect(canViewAdminSection("crm", ["MANAGER"])).toBe(false);
  });
});

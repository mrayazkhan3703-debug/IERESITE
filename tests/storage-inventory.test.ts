import { expect, test } from "bun:test";
import type { SessionUser } from "@/server/auth";
import { requireStorageInventoryOwner } from "@/server/media/storage-inventory";

const actor = (roles: string[]): SessionUser => ({ id: "fixture", sessionId: "fixture", email: "fixture@example.invalid", name: null,
  organizationId: null, roles, permissions: ["media:read"], mfaVerified: true });
test("complete private/retained storage inventory is owner-only even with media permission", () => {
  expect(() => requireStorageInventoryOwner(actor(["OWNER"]))).not.toThrow();
  for (const roles of [["ADMIN"], ["MANAGER"], ["CONTENT_EDITOR"], ["ANALYST"], []]) {
    expect(() => requireStorageInventoryOwner(actor(roles))).toThrow("website owner");
  }
});

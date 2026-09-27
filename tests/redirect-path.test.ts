import { describe, expect, it } from "bun:test";
import { isSafeInternalRedirectPath } from "@/server/seo/redirect-path";

describe("stored redirect destination validation", () => {
  it("allows only normalized same-site public paths", () => {
    expect(isSafeInternalRedirectPath("/")).toBe(true);
    expect(isSafeInternalRedirectPath("/properties/valid-slug_1")).toBe(true);
    expect(isSafeInternalRedirectPath("/communities/palm-jumeirah" )).toBe(true);
  });

  it("rejects external, ambiguous, encoded and reserved destinations", () => {
    for (const path of [
      "https://attacker.invalid",
      "//attacker.invalid",
      "/\\attacker.invalid",
      "/%2f%2fattacker.invalid",
      "/a/../admin",
      "/properties//listing",
      "/account/preferences",
      "/api/health",
      "/properties/slug?next=https://attacker.invalid",
      "/properties/slug#fragment",
    ]) {
      expect(isSafeInternalRedirectPath(path)).toBe(false);
    }
  });
});

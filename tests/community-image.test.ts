import { describe, expect, test } from "bun:test";
import { communityImageFallback } from "../src/components/community-image";

describe("community image fallback", () => {
  test("maps only recognized slugs to checked-in image files", () => {
    expect(communityImageFallback("dubai-marina")).toBe("/images/communities/dubai-marina.jpg");
    expect(communityImageFallback("JVC")).toBe("/images/communities/jvc.jpg");
  });
  test("uses the designed fallback for unknown or path-like slugs", () => {
    expect(communityImageFallback("unknown-area")).toBe("/images/communities/community-placeholder.svg");
    expect(communityImageFallback("../../private")).toBe("/images/communities/community-placeholder.svg");
  });
});

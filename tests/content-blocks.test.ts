import { describe, expect, test } from "bun:test";
import { isSafeContentHref, parseContentBlocks, readContentBlocks, type ContentBlock } from "@/lib/content-blocks";

describe("structured content blocks", () => {
  test("accepts bounded supported blocks and rejects malformed or over-limit input", () => {
    const value: ContentBlock[] = [
      { type: "heading", level: 2, text: "Overview" },
      { type: "paragraph", text: "A safely rendered paragraph." },
      { type: "list", ordered: true, items: ["One", "Two"] },
      { type: "link", label: "Read more", href: "/guides/example" },
    ];
    expect(parseContentBlocks(value)).toEqual(value);
    expect(parseContentBlocks([{ type: "heading", level: 1, text: "Unsupported level" }])).toBeNull();
    expect(parseContentBlocks([{ type: "paragraph", text: "x".repeat(5_001) }])).toBeNull();
    expect(parseContentBlocks(Array.from({ length: 101 }, () => ({ type: "paragraph", text: "x" })))).toBeNull();
    expect(readContentBlocks(JSON.stringify(value))).toEqual(value);
    expect(readContentBlocks("not-json")).toBeNull();
  });

  test("allows only safe links and public media identifiers", () => {
    expect(isSafeContentHref("https://example.com/page")).toBe(true);
    expect(isSafeContentHref("mailto:team@example.com")).toBe(true);
    expect(isSafeContentHref("/guides/example")).toBe(true);
    expect(isSafeContentHref("//example.com/path")).toBe(false);
    expect(isSafeContentHref("javascript:alert(1)")).toBe(false);
    expect(isSafeContentHref("data:text/html,unsafe")).toBe(false);
    expect(parseContentBlocks([{ type: "image", mediaId: "asset-1", altText: "Market skyline" }])).toEqual([
      { type: "image", mediaId: "asset-1", altText: "Market skyline" },
    ]);
    expect(parseContentBlocks([{ type: "image", mediaId: "asset-1", altText: "" }])).toBeNull();
  });
});

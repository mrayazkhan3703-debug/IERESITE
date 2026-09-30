import { describe, expect, test } from "bun:test";
import { mediaMatchesMode, galleryAttachmentSchema, floorPlanAttachmentSchema, documentAttachmentSchema } from "@/lib/media-contract";
import { localMediaPath } from "@/server/media/file-storage";
import { parseByteRange } from "@/server/media/byte-range";

describe("shared inline media contracts", () => {
  test("each mode accepts its supported types", () => {
    expect(mediaMatchesMode({ mimeType: "image/avif" }, "single-image")).toBe(true);
    expect(mediaMatchesMode({ mimeType: "application/pdf" }, "single-image")).toBe(false);
    expect(mediaMatchesMode({ mimeType: "video/mp4" }, "gallery")).toBe(true);
    expect(mediaMatchesMode({ mimeType: "video/webm" }, "video")).toBe(true);
    expect(mediaMatchesMode({ mimeType: "application/pdf" }, "floor-plan")).toBe(true);
    expect(mediaMatchesMode({ mimeType: "image/png" }, "floor-plan")).toBe(true);
    expect(mediaMatchesMode({ mimeType: "video/mp4" }, "document")).toBe(false);
  });
  test("attachment metadata is bounded and browser presentation data is excluded", () => {
    expect(galleryAttachmentSchema.parse({ mediaId: "asset", caption: "Living room", url: "javascript:unsafe" })).toEqual({ mediaId: "asset", caption: "Living room" });
    expect(galleryAttachmentSchema.safeParse({ mediaId: "asset", altText: "a".repeat(301) }).success).toBe(false);
    expect(floorPlanAttachmentSchema.safeParse({ mediaId: "asset", bedrooms: -1 }).success).toBe(false);
    expect(documentAttachmentSchema.parse({ mediaId: "asset" }).gated).toBe(false);
    expect(documentAttachmentSchema.safeParse({ mediaId: "asset", docType: "EXECUTABLE" }).success).toBe(false);
  });
});

describe("video byte range parsing", () => {
  test("supports bounded, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=0-9999", 1000)).toEqual({ start: 0, end: 999 });
  });
  test("rejects multipart, invalid and unsatisfiable ranges", () => {
    for (const value of ["bytes=0-1,3-4", "bytes=1000-", "bytes=9-2", "bytes=-0", "bytes=-", "bytes=a-1", "bytes=9007199254740993-"]) expect(parseByteRange(value, 1000)).toBeNull();
  });
});

test("local storage paths cannot escape the protected media adapter", () => {
  expect(localMediaPath("local/media/123abc-def.png")).toContain(".data");
  expect(localMediaPath("123abc-def.pdf")).toContain("uploads");
  for (const key of ["../credentials", "local/media/../../secret", "local/media/test.exe/other", "private/portfolio/secret"]) expect(() => localMediaPath(key)).toThrow();
});

import { expect, test } from "bun:test";
import { mediaCaption, mediaPreviewUrl } from "@/lib/media-preview";
import { mediaDtoSchema } from "@/lib/contracts";

test("public media contracts retain video posters without replacing playback URLs", () => {
  const video = mediaDtoSchema.parse({ id: "fixture", url: "/api/media/fixture/content", kind: "VIDEO", mimeType: "video/mp4", posterUrl: "/poster.webp" });
  expect(mediaPreviewUrl(video)).toBe("/poster.webp");
  expect(video.url).toBe("/api/media/fixture/content");
  expect(mediaPreviewUrl({ ...video, posterUrl: null })).toBeNull();
});

test("visible captions retain editorial copy independently of accessibility descriptions", () => {
  expect(mediaCaption({ caption: "Verified courtyard view", altText: "Courtyard with trees" }, "Property")).toBe("Verified courtyard view");
  expect(mediaCaption({ caption: "  ", altText: "Neutral video" }, "Property")).toBe("Neutral video");
  expect(mediaCaption({ caption: null, altText: null }, "Property")).toBe("Property");
});
test("thumbnail selection handles images, absent media, legacy videos and documents", () => {
  expect(mediaPreviewUrl(null)).toBeNull();
  expect(mediaPreviewUrl({ url: "/image.avif", kind: "IMAGE" })).toBe("/image.avif");
  expect(mediaPreviewUrl({ url: "/legacy.webm?version=1" })).toBeNull();
  expect(mediaPreviewUrl({ url: "/legacy.pdf" })).toBeNull();
  expect(mediaPreviewUrl({ url: "/api/media/file/content", kind: "DOCUMENT" })).toBeNull();
});

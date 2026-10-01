import { expect, test } from "bun:test";
import { mediaPreviewUrl } from "@/lib/media-preview";
import { mediaDtoSchema } from "@/lib/contracts";

test("public media contracts retain video posters without replacing playback URLs", () => {
  const video = mediaDtoSchema.parse({ id: "fixture", url: "/api/media/fixture/content", kind: "VIDEO", mimeType: "video/mp4", posterUrl: "/poster.webp" });
  expect(mediaPreviewUrl(video)).toBe("/poster.webp");
  expect(video.url).toBe("/api/media/fixture/content");
  expect(mediaPreviewUrl({ ...video, posterUrl: null })).toBeNull();
});
test("thumbnail selection handles images, absent media, legacy videos and documents", () => {
  expect(mediaPreviewUrl(null)).toBeNull();
  expect(mediaPreviewUrl({ url: "/image.avif", kind: "IMAGE" })).toBe("/image.avif");
  expect(mediaPreviewUrl({ url: "/legacy.webm?version=1" })).toBeNull();
  expect(mediaPreviewUrl({ url: "/legacy.pdf" })).toBeNull();
  expect(mediaPreviewUrl({ url: "/api/media/file/content", kind: "DOCUMENT" })).toBeNull();
});

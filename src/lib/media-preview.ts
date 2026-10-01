import type { MediaDTO } from "./types";

/** Thumbnails never feed a video or document URL to an image element. */
export function mediaPreviewUrl(media?: Pick<MediaDTO, "url" | "kind" | "mimeType" | "posterUrl"> | null): string | null {
  if (!media) return null;
  if (media.kind === "VIDEO" || media.mimeType?.startsWith("video/") || /\.(mp4|webm)(?:[?#]|$)/i.test(media.url)) return media.posterUrl || null;
  if (media.kind === "DOCUMENT" || media.mimeType === "application/pdf" || /\.pdf(?:[?#]|$)/i.test(media.url)) return null;
  return media.url || null;
}

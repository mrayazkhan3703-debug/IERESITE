import { z } from "zod";

export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "application/pdf", "video/mp4", "video/webm"] as const;
export type MediaMode = "single-image" | "multi-image" | "video" | "image-or-video" | "document" | "gallery" | "floor-plan" | "image-or-document" | "library";
export interface MediaAssetChoice {
  id: string; url: string; kind: string; mimeType: string; originalFilename?: string;
  altText?: string | null; caption?: string | null; updatedAt?: string;
  posterMediaId?: string | null; posterUrl?: string | null;
}
export interface MediaAttachment {
  mediaId: string; url?: string; kind?: string; mimeType?: string;
  isCover?: boolean; altText?: string | null; caption?: string | null; posterUrl?: string | null;
}
export function withGalleryCover(rows: MediaAttachment[], mediaId: string): MediaAttachment[] {
  if (!mediaId) return rows.filter((row) => !row.isCover);
  const existing = rows.some((row) => row.mediaId === mediaId);
  const selected = rows.map((row) => ({ ...row, isCover: row.mediaId === mediaId }));
  return existing ? selected : [...selected, { mediaId, kind: "IMAGE", isCover: true }];
}
export const galleryAttachmentSchema = z.object({
  mediaId: z.string().min(1).max(100), isCover: z.boolean().optional(),
  altText: z.string().max(300).nullable().optional(), caption: z.string().max(500).nullable().optional(),
});
export const floorPlanAttachmentSchema = z.object({
  mediaId: z.string().min(1).max(100), label: z.string().max(160).nullable().optional(),
  bedrooms: z.number().min(0).max(30).nullable().optional(),
  areaSqft: z.number().positive().max(100000000).nullable().optional(),
  priceAed: z.number().min(0).max(1000000000).nullable().optional(),
});
export const documentAttachmentSchema = z.object({
  mediaId: z.string().min(1).max(100), label: z.string().max(160).nullable().optional(),
  docType: z.enum(["BROCHURE", "FLOOR_PLAN_PACK", "TITLE_DEED", "ESCALATION", "OTHER"]).default("BROCHURE"),
  gated: z.boolean().default(false),
});
export const entityMediaSchema = {
  gallery: z.array(galleryAttachmentSchema).max(60).optional(),
  documents: z.array(documentAttachmentSchema).max(30).optional(),
};
export interface EntityMediaInput {
  gallery?: z.infer<typeof galleryAttachmentSchema>[];
  progressGallery?: z.infer<typeof galleryAttachmentSchema>[];
  floorPlans?: z.infer<typeof floorPlanAttachmentSchema>[];
  documents?: z.infer<typeof documentAttachmentSchema>[];
}
export function mediaMatchesMode(asset: Pick<MediaAssetChoice, "mimeType">, mode: MediaMode): boolean {
  const image = asset.mimeType.startsWith("image/");
  const video = asset.mimeType === "video/mp4" || asset.mimeType === "video/webm";
  const document = asset.mimeType === "application/pdf";
  if (mode === "library") return image || video || document;
  if (mode === "document") return document;
  if (mode === "floor-plan" || mode === "image-or-document") return image || document;
  if (mode === "video") return video;
  if (mode === "gallery" || mode === "image-or-video") return image || video;
  return image;
}

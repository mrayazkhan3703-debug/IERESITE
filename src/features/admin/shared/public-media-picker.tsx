"use client";
import { MediaField } from "./media-field";
import type { MediaMode } from "@/lib/media-contract";

/** Compatibility wrapper: all existing entity fields share the inline uploader. */
export function PublicMediaPicker({ label, value, onChange, allowedKinds = ["IMAGE"] }: {
  label: string; value: string; onChange: (value: string) => void; allowedKinds?: string[];
}) {
  const images = allowedKinds.some((kind) => ["IMAGE", "LOGO", "FLOOR_PLAN"].includes(kind));
  const documents = allowedKinds.some((kind) => ["DOCUMENT", "BROCHURE"].includes(kind));
  const mode: MediaMode = images && documents ? "image-or-document" : documents ? "document" : allowedKinds.includes("VIDEO") ? "image-or-video" : "single-image";
  return <MediaField label={label} value={value} onChange={onChange} mode={mode} />;
}

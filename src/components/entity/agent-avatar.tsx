"use client";

import * as React from "react";
import Image from "next/image";
import { SITE_LOGO } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Agent photo rendering with initials fallback (V3-02, V3 §35).
 * - prefers the direct photoUrl asset (verified team photos / advisory-desk logo);
 * - falls back to the media-registry photo (MediaDTO) when present;
 * - elegant initials fallback on load error or when no photo exists —
 *   never a broken-image UI, never a generated fake portrait.
 */

/** Resolve an agent photoUrl for a LIGHT surface (cards/panels). */
export function agentPhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  /* The official logo artwork is white + gold (built for dark surfaces);
   * swap to the ink-adapted variant when rendered on light surfaces. */
  if (photoUrl === SITE_LOGO.dark) return SITE_LOGO.light;
  return photoUrl;
}

export function AgentAvatar({
  name,
  photoUrl,
  photo,
  alt,
  className,
  rounded = "rounded-xl",
}: {
  name: string;
  /** Direct static asset path (AgentDTO.photoUrl). */
  photoUrl?: string | null;
  /** Alt text override; defaults to the member name. */
  alt?: string;
  /** Media-registry photo (AgentDTO.photo) — used when photoUrl is absent. */
  photo?: { url: string } | null;
  className?: string;
  rounded?: string;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const src = agentPhotoSrc(photoUrl) ?? photo?.url ?? null;
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  if (src && src !== failedSrc) {
    /* Intrinsic dims: team photos are 720×720 squares; the advisory-desk
     * fallback renders the official logo (600×192). Call sites pin exact CSS
     * dims, so these attrs are aspect hints for pre-layout only (V3-21). */
    const isLogo = src === SITE_LOGO.light || src === SITE_LOGO.dark;
    const imageClass = cn("shrink-0 object-cover", rounded, className);
    // Only known local raster portraits; do not fetch arbitrary provider/media URLs.
    if (/^\/images\/team\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/.test(src)) {
      return <Image src={src} alt={alt ?? name} width={720} height={720} sizes="128px"
        loading="lazy" onError={() => setFailedSrc(src)} className={imageClass} />;
    }
    return (

      <img
        src={src}
        alt={alt ?? name}
        loading="lazy"
        decoding="async"
        width={isLogo ? SITE_LOGO.width : 720}
        height={isLogo ? SITE_LOGO.height : 720}
        onError={() => setFailedSrc(src)}
        className={imageClass}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center bg-brand-soft font-display font-semibold text-brand-strong select-none",
        rounded,
        className
      )}
    >
      {initials}
    </div>
  );
}

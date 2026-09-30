"use client";

import * as React from "react";
import { useSiteSettings } from "@/components/providers/site-settings-provider";

/** A configured fallback is labelled so it cannot be mistaken for a listing photograph. */
export function PublicImage({ src, alt, className, width, height, fallback }: { src?: string | null; alt: string; className?: string; width?: number; height?: number; fallback: React.ReactNode }) {
  const settings = useSiteSettings();
  const defaultSrc = settings.fallbackImageMediaId ? `/api/media/${encodeURIComponent(settings.fallbackImageMediaId)}/content` : null;
  const [failed, setFailed] = React.useState<string[]>([]);
  React.useEffect(() => setFailed([]), [src, defaultSrc]);
  const selected = [src, defaultSrc].find((value): value is string => Boolean(value && !failed.includes(value)));
  if (!selected) return <>{fallback}</>;
  const isFallback = selected !== src;
  return <><img src={selected} alt={isFallback ? "Image unavailable — default site image" : alt} width={width} height={height} loading="lazy" decoding="async" className={className} onError={() => setFailed((current) => current.includes(selected) ? current : [...current, selected])} />{isFallback && <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">Image unavailable</span>}</>;
}

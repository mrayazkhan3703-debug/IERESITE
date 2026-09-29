"use client";
import * as React from "react";
import Image from "next/image";
import { api } from "@/lib/api-client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function isPublicMediaUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/uploads/") || value.startsWith("/api/media/"));
}

export function PublicMediaPicker({ label, value, onChange, allowedKinds = ["IMAGE"] }: {
  label: string; value: string; onChange: (value: string) => void; allowedKinds?: string[];
}) {
  const [assets, setAssets] = React.useState<Record<string, unknown>[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const kindsKey = allowedKinds.join(",");
  React.useEffect(() => {
    let active = true;
    const kinds = new Set(kindsKey.split(","));
    api.get<{ media: Record<string, unknown>[] }>("/api/media?take=100").then(async ({ media }) => {
      const available = media.filter((asset) => asset.isPrivate === false && kinds.has(String(asset.kind)));
      if (value && !available.some((asset) => asset.id === value)) {
        try {
          const existing = await api.get<Record<string, unknown>>(`/api/media/${encodeURIComponent(value)}`);
          if (existing.isPrivate !== true && kinds.has(String(existing.kind))) available.unshift(existing);
        } catch { /* A stale or private selection stays out of the public picker. */ }
      }
      if (active) setAssets(available);
    }).catch(() => { if (active) { setAssets([]); setLoadFailed(true); } });
    return () => { active = false; };
  }, [value, kindsKey]);
  const selected = assets?.find((asset) => asset.id === value);
  return <div className="space-y-2"><label className="block space-y-1.5 text-sm font-medium">{label}<Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}><SelectTrigger><SelectValue placeholder="No public asset selected" /></SelectTrigger><SelectContent><SelectItem value="none">No asset selected</SelectItem>{assets?.map((asset) => <SelectItem key={String(asset.id)} value={String(asset.id)}>{String(asset.altText || asset.id)} · {String(asset.kind)}</SelectItem>)}</SelectContent></Select></label>
    {loadFailed && <p className="text-xs text-destructive">Public Media Library options could not be loaded.</p>}{assets?.length === 0 && !loadFailed && <p className="text-xs text-muted-foreground">No public assets of this type are available.</p>}
    {selected && isPublicMediaUrl(selected.url) && selected.kind === "IMAGE" && <div className="max-w-xs overflow-hidden rounded-lg border border-border/70"><Image src={selected.url} alt={String(selected.altText ?? "")} width={480} height={270} unoptimized className="h-32 w-full object-cover" /></div>}
    {selected && isPublicMediaUrl(selected.url) && selected.kind !== "IMAGE" && <a className="text-xs underline" href={selected.url} target="_blank" rel="noopener noreferrer">Open selected public document</a>}
  </div>;
}

"use client";

import * as React from "react";
import Image from "next/image";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type GalleryItem = { mediaId: string; isCover?: boolean; url?: string; altText?: string | null; sortOrder?: number };
type Asset = { id: string; url: string; altText: string | null; kind: string };

export function MediaGalleryEditor({ entity, entityId, initialGallery, section = "GALLERY", onChanged }: {
  entity: "property" | "project"; entityId: string; initialGallery: GalleryItem[]; section?: "GALLERY" | "PROGRESS"; onChanged?: () => void;
}) {
  const [gallery, setGallery] = React.useState(initialGallery);
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);

  React.useEffect(() => setGallery(initialGallery), [initialGallery]);
  React.useEffect(() => {
    let active = true;
    api.get<{ media: Asset[] }>("/api/media?take=100&kind=IMAGE").then((data) => { if (active) setAssets(data.media); }).catch(() => { if (active) setAssets([]); });
    return () => { active = false; };
  }, []);

  const send = async (method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const url = "/api/admin/media/gallery";
      const sectionPayload = entity === "project" ? { section } : {};
      const requestPayload = { ...payload, ...sectionPayload };
      const response = method === "POST" ? await api.post<{ mediaIds: string[]; coverMediaId: string | null }>(url, requestPayload)
        : method === "PATCH" ? await api.patch<{ mediaIds: string[]; coverMediaId: string | null }>(url, requestPayload)
          : await api.delete<{ mediaIds: string[]; coverMediaId: string | null }>(url, requestPayload);
      const next = response.mediaIds.map((mediaId, sortOrder) => {
        const asset = assets.find((item) => item.id === mediaId);
        const previous = gallery.find((item) => item.mediaId === mediaId);
        return { mediaId, url: asset?.url ?? previous?.url, altText: asset?.altText ?? previous?.altText ?? null, sortOrder, isCover: entity === "property" && mediaId === response.coverMediaId };
      });
      setGallery(next);
      onChanged?.();
      return response.mediaIds;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gallery update failed");
      return null;
    } finally { setBusy(false); }
  };

  const attach = async () => {
    if (!selected) return;
    const next = await send("POST", { entity, entityId, action: "attach", mediaIds: [selected] });
    if (next) { setSelected(""); toast.success("Image added to gallery"); }
  };
  const reorder = async (mediaId: string, delta: -1 | 1) => {
    const ids = gallery.map((item) => item.mediaId);
    const index = ids.indexOf(mediaId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    await send("PATCH", { entity, entityId, action: "reorder", mediaIds: ids, coverMediaId: entity === "property" ? gallery.find((item) => item.isCover)?.mediaId ?? ids[0] ?? null : null });
  };
  const moveTo = async (mediaId: string, targetMediaId: string) => {
    if (mediaId === targetMediaId) return;
    const ids = gallery.map((item) => item.mediaId);
    const from = ids.indexOf(mediaId);
    const to = ids.indexOf(targetMediaId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    await send("PATCH", { entity, entityId, action: "reorder", mediaIds: ids, coverMediaId: entity === "property" ? gallery.find((item) => item.isCover)?.mediaId ?? ids[0] ?? null : null });
  };
  const remove = async (mediaId: string) => {
    await send("DELETE", { entity, entityId, action: "detach", mediaIds: [mediaId] });
    toast.success("Image removed from gallery");
  };
  const setCover = async (mediaId: string) => {
    await send("PATCH", { entity, entityId, action: "reorder", mediaIds: gallery.map((item) => item.mediaId), coverMediaId: mediaId });
  };
  const available = assets.filter((asset) => asset.kind === "IMAGE" && !gallery.some((item) => item.mediaId === asset.id) && (!q || `${asset.altText ?? ""} ${asset.id}`.toLowerCase().includes(q.toLowerCase())));

  const sectionTitle = entity === "project" && section === "PROGRESS" ? "Construction progress gallery" : entity === "project" ? "Project gallery" : "Property gallery";
  return <section className="space-y-3 rounded-lg border border-border/70 p-3" aria-label={sectionTitle}>
    <div><h3 className="text-sm font-semibold">{sectionTitle}</h3><p className="text-xs text-muted-foreground">Choose existing public image assets. Changes are saved immediately and audited.</p></div>
    <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
      <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find media by alt text or ID" aria-label="Find gallery media" />
      <Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="Select a gallery image"><SelectValue placeholder="Choose an image" /></SelectTrigger><SelectContent>{available.slice(0, 50).map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.altText || asset.id.slice(0, 18)}</SelectItem>)}</SelectContent></Select>
      <Button type="button" variant="outline" onClick={attach} disabled={busy || !selected}>Add image</Button>
    </div>
    {gallery.length === 0 ? <p className="text-xs text-muted-foreground">No gallery images selected.</p> : <ol className="grid gap-2 sm:grid-cols-2">
      {gallery.map((item, index) => <li key={item.mediaId} draggable onDragStart={(event) => { setDragging(item.mediaId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.mediaId); }} onDragEnd={() => setDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const movedId = event.dataTransfer.getData("text/plain") || dragging; setDragging(null); if (movedId) void moveTo(movedId, item.mediaId); }} className={`flex items-center gap-2 rounded-md border border-border/60 p-2 ${dragging === item.mediaId ? "opacity-50" : ""}`}>
        {item.url && <Image src={item.url} alt={item.altText ?? ""} width={96} height={64} unoptimized className="h-16 w-24 rounded object-cover" />}
        <div className="min-w-0 flex-1"><p className="truncate text-xs">{item.altText || item.mediaId}</p>{entity === "property" && <Select value={item.isCover ? item.mediaId : "none"} onValueChange={(value) => value !== "none" && setCover(value)}><SelectTrigger className="mt-1 h-8 text-xs" aria-label={`Cover image ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Gallery image</SelectItem><SelectItem value={item.mediaId}>Property cover</SelectItem></SelectContent></Select>}</div>
        <div className="flex flex-col gap-1"><Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={busy || index === 0} onClick={() => reorder(item.mediaId, -1)} aria-label={`Move image ${index + 1} up`}>↑</Button><Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={busy || index === gallery.length - 1} onClick={() => reorder(item.mediaId, 1)} aria-label={`Move image ${index + 1} down`}>↓</Button><Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={() => remove(item.mediaId)}>Remove</Button></div>
      </li>)}
    </ol>}
  </section>;
}

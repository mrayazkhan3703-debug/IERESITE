"use client";

import * as React from "react";
import Image from "next/image";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MEDIA_MIME_TYPES, mediaMatchesMode, type MediaAssetChoice, type MediaAttachment, type MediaMode } from "@/lib/media-contract";

const UploadState = React.createContext<((id: string, busy: boolean) => void) | null>(null);
export function MediaForm({ children, onSubmit, ...props }: React.ComponentProps<"form">) {
  const [uploads, setUploads] = React.useState<Record<string, boolean>>({});
  const register = React.useCallback((id: string, busy: boolean) => setUploads((previous) => {
    if (Boolean(previous[id]) === busy) return previous;
    const next = { ...previous }; if (busy) next[id] = true; else delete next[id]; return next;
  }), []);
  const busy = Object.values(uploads).some(Boolean);
  return <UploadState.Provider value={register}><form {...props} onSubmit={(event) => {
    if (busy) { event.preventDefault(); return; }
    onSubmit?.(event);
  }}>{busy && <p role="status" className="rounded border p-3 text-sm">Uploads are in progress. Wait for them to finish before saving this form.</p>}{children}</form></UploadState.Provider>;
}

export function MediaPreview({ asset }: { asset: Pick<MediaAssetChoice, "url" | "mimeType" | "altText" | "posterUrl"> }) {
  if (!asset.url.startsWith("/api/media/") && !asset.url.startsWith("/uploads/")) return null;
  if (asset.mimeType.startsWith("image/")) return <Image src={asset.url} alt={asset.altText ?? ""} width={480} height={270} unoptimized className="h-36 w-full rounded-md object-contain bg-muted" />;
  if (asset.mimeType.startsWith("video/")) return <video controls preload="metadata" poster={asset.posterUrl ?? undefined} className="h-36 w-full rounded-md bg-muted" src={asset.url} aria-label={asset.altText || "Video preview"} />;
  return <a href={asset.url} target="_blank" rel="noopener noreferrer" className="block rounded-md bg-muted p-4 underline">Preview PDF document</a>;
}

interface UploadItem {
  key: string; file: File; progress: number;
  status: "waiting" | "uploading" | "processing" | "done" | "failed" | "cancelled";
  error?: string; existing?: MediaAssetChoice;
}

export function MediaUploader({ mode, kind, altText, multiple = false, onUploaded, onBusyChange }: {
  mode: MediaMode; kind?: string; altText?: string; multiple?: boolean;
  onUploaded: (asset: MediaAssetChoice) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [policy, setPolicy] = React.useState<{ maxBytes: number; allowedMimeTypes: string[] } | null>(null);
  const [error, setError] = React.useState("");
  const uploadId = React.useId();
  const register = React.useContext(UploadState);
  const input = React.useRef<HTMLInputElement>(null);
  const requests = React.useRef(new Map<string, XMLHttpRequest>());
  const running = React.useRef(false);
  const mounted = React.useRef(true);
  const uploaded = React.useRef(onUploaded);
  uploaded.current = onUploaded;
  const busy = items.some((item) => ["waiting", "uploading", "processing"].includes(item.status));
  React.useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  React.useEffect(() => { register?.(uploadId, busy); return () => register?.(uploadId, false); }, [register, uploadId, busy]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current.forEach((request) => request.abort()); };
  }, []);
  const loadPolicy = React.useCallback(() => {
    setError("");
    api.get<{ maxBytes: number; allowedMimeTypes: string[] }>("/api/media?policy=1").then(setPolicy).catch(() => setError("Upload policy could not be loaded. Try again."));
  }, []);
  React.useEffect(loadPolicy, [loadPolicy]);
  const update = (key: string, value: Partial<UploadItem>) => {
    if (mounted.current) setItems((previous) => previous.map((item) => item.key === key ? { ...item, ...value } : item));
  };
  async function send(item: UploadItem) {
    if (!policy) return;
    if (item.file.size === 0 || item.file.size > policy.maxBytes || !policy.allowedMimeTypes.includes(item.file.type) || !mediaMatchesMode({ mimeType: item.file.type }, mode)) {
      update(item.key, { status: "failed", error: "Choose a supported file up to " + Math.floor(policy.maxBytes / 1048576) + " MB." });
      return;
    }
    await new Promise<void>((resolve) => {
      const request = new XMLHttpRequest();
      requests.current.set(item.key, request);
      const finish = () => { requests.current.delete(item.key); resolve(); };
      request.open("POST", "/api/media");
      request.setRequestHeader("x-requested-with", "fetch");
      request.timeout = 120000;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) update(item.key, { progress: Math.round(event.loaded / event.total * 100), status: event.loaded === event.total ? "processing" : "uploading" });
      };
      request.onload = () => {
        try {
          const response = JSON.parse(request.responseText) as MediaAssetChoice & { error?: string; code?: string; existingAsset?: MediaAssetChoice };
          if (request.status >= 200 && request.status < 300) {
            update(item.key, { status: "done", progress: 100 });
            if (mounted.current) uploaded.current(response);
          } else update(item.key, { status: "failed", error: response.error || "Upload failed.", existing: response.code === "DUPLICATE_MEDIA" ? response.existingAsset : undefined });
        } catch { update(item.key, { status: "failed", error: "Upload response could not be read. Retry or choose the asset from Media Library." }); }
        finally { finish(); }
      };
      request.onerror = () => { update(item.key, { status: "failed", error: "Connection interrupted. Retry this upload." }); finish(); };
      request.ontimeout = () => { update(item.key, { status: "failed", error: "Upload timed out. Retry or check Media Library." }); finish(); };
      request.onabort = () => { update(item.key, { status: "cancelled", error: "Upload cancelled." }); finish(); };
      const data = new FormData();
      data.append("file", item.file);
      if (altText) data.append("altText", altText);
      if (kind) data.append("kind", kind);
      update(item.key, { status: "uploading", progress: 0, error: undefined, existing: undefined });
      request.send(data);
    });
  }
  async function run(batch: UploadItem[]) {
    if (running.current) return;
    running.current = true;
    try { for (const item of batch) { if (!mounted.current) break; await send(item); } }
    finally { running.current = false; }
  }
  function choose(files: FileList | null) {
    if (!files || running.current || !policy) return;
    const batch = Array.from(files).slice(0, multiple ? 60 : 1).map((file) => ({ key: crypto.randomUUID(), file, progress: 0, status: "waiting" as const }));
    setItems((previous) => [...previous, ...batch]);
    void run(batch);
  }
  const accept = MEDIA_MIME_TYPES.filter((mimeType) => mediaMatchesMode({ mimeType }, mode)).join(",");
  return <div className="space-y-3 rounded-lg border border-dashed p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files); }}>
    <input ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" aria-label="Upload new media" onChange={(event) => { choose(event.target.files); event.target.value = ""; }} />
    <Button type="button" variant="outline" disabled={!policy || busy} onClick={() => input.current?.click()}>Choose files or drop them here</Button>
    <p className="text-xs text-muted-foreground">Up to 25 MB per file. Uploaded assets remain in Media Library if you discard this form.</p>
    {error && <p role="alert">{error} <Button type="button" variant="outline" onClick={loadPolicy}>Retry</Button></p>}
    <ul className="space-y-2" aria-live="polite">{items.map((item) => <li key={item.key} className="text-sm">
      <span>{item.file.name} · {item.status === "processing" ? "Processing media…" : item.status}</span>
      {["waiting", "uploading", "processing"].includes(item.status) && <progress value={item.progress} max={100} aria-label={"Upload progress for " + item.file.name} className="block w-full" />}
      {item.error && <p className="text-destructive">{item.error}</p>}
      {requests.current.has(item.key) && <Button type="button" variant="outline" size="sm" onClick={() => requests.current.get(item.key)?.abort()}>Cancel upload</Button>}
      {["failed", "cancelled"].includes(item.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { update(item.key, { status: "waiting" }); void run([item]); }}>Retry</Button>}
      {item.existing && <Button type="button" size="sm" onClick={() => { uploaded.current(item.existing!); update(item.key, { status: "done", error: undefined, existing: undefined }); }}>Use existing asset</Button>}
    </li>)}</ul>
  </div>;
}

export function MediaPicker({ open, onOpenChange, mode, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void; mode: MediaMode; onSelect: (asset: MediaAssetChoice) => void;
}) {
  const [q, setQ] = React.useState("");
  const [cursor, setCursor] = React.useState("");
  const [page, setPage] = React.useState<{ media: MediaAssetChoice[]; nextCursor?: string | null }>({ media: [] });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      api.get<typeof page>("/api/media?" + new URLSearchParams({ take: "24", q, mode, ...(cursor ? { cursor } : {}) })).then((result) => {
        if (active) setPage(result);
      }).catch(() => { if (active) setError("Media Library could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [open, q, cursor, mode, retry]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
    <DialogTitle>Choose existing media</DialogTitle><DialogDescription>Select a reusable asset from Media Library.</DialogDescription>
    <Input aria-label="Search Media Library" value={q} onChange={(event) => { setQ(event.target.value); setCursor(""); }} placeholder="Search filename, caption or alt text" />
    {loading && <p role="status">Loading media…</p>}
    {error && <p role="alert">{error} <Button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</Button></p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{page.media.filter((asset) => mediaMatchesMode(asset, mode)).map((asset) => <button type="button" key={asset.id} className="rounded-lg border p-2 text-left focus-visible:ring-2" onClick={() => { onSelect(asset); onOpenChange(false); }}>
      {asset.mimeType.startsWith("image/") ? <MediaPreview asset={asset} /> : <div className="flex h-24 items-center justify-center rounded bg-muted">{asset.kind}</div>}
      <span className="block truncate text-sm">{asset.originalFilename || asset.altText || asset.id}</span>
    </button>)}</div>
    {!loading && !error && page.media.length === 0 && <p>No matching media found.</p>}
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={!cursor || loading} onClick={() => setCursor("")}>First page</Button><Button type="button" variant="outline" disabled={!page.nextCursor || loading} onClick={() => setCursor(page.nextCursor!)}>Next page</Button></div>
  </DialogContent></Dialog>;
}

export function MediaField({ label, value, onChange, mode = "single-image", kind, onBusyChange }: {
  label: string; value: string; onChange: (id: string) => void; mode?: MediaMode; kind?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const [asset, setAsset] = React.useState<MediaAssetChoice | null>(null);
  const [error, setError] = React.useState("");
  const [upload, setUpload] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [posterSaving, setPosterSaving] = React.useState(false);
  React.useEffect(() => {
    let active = true; setError("");
    if (!value) { setAsset(null); return; }
    api.get<MediaAssetChoice>("/api/media/" + encodeURIComponent(value)).then((result) => { if (active) setAsset(result); }).catch(() => { if (active) { setAsset(null); setError("Selected media could not be loaded."); } });
    return () => { active = false; };
  }, [value]);
  const select = (next: MediaAssetChoice) => { setAsset(next); onChange(next.id); };
  const savePoster = async (posterMediaId: string) => {
    if (!asset?.updatedAt || posterSaving) return;
    setPosterSaving(true); setError("");
    try {
      await api.patch("/api/media/" + encodeURIComponent(asset.id), { expectedUpdatedAt: asset.updatedAt, altText: asset.altText ?? null, caption: asset.caption ?? null, posterMediaId: posterMediaId || null });
      setAsset(await api.get<MediaAssetChoice>("/api/media/" + encodeURIComponent(asset.id)));
    } catch (error) { setError(error instanceof Error ? error.message : "Poster could not be saved."); }
    finally { setPosterSaving(false); }
  };
  return <div role="group" aria-label={label} className="space-y-2 rounded-lg border p-3">
    <h4 className="text-sm font-medium">{label}</h4>
    {asset && <MediaPreview asset={asset} />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setUpload((value) => !value)}>{value ? "Replace / Upload New" : "Upload New"}</Button><Button type="button" variant="outline" size="sm" onClick={() => setPicker(true)}>Choose Existing</Button>{value && <Button type="button" variant="outline" size="sm" onClick={() => { setAsset(null); onChange(""); }}>Remove</Button>}</div>
    {upload && <MediaUploader mode={mode} kind={kind} onUploaded={select} onBusyChange={onBusyChange} />}
    {asset?.mimeType.startsWith("video/") && <div><p className="text-xs text-muted-foreground">The poster belongs to this video asset and is shared wherever this video is used. No poster uses a neutral player background.</p><MediaField label="Video poster image" value={asset.posterMediaId ?? ""} onChange={(id) => { void savePoster(id); }} />{posterSaving && <p role="status">Saving video poster…</p>}</div>}
    <MediaPicker open={picker} onOpenChange={setPicker} mode={mode} onSelect={select} />
  </div>;
}

export function MediaGalleryManager({ label, value, onChange, mode = "gallery", primary = true, kind, onBusyChange }: {
  label: string; value: MediaAttachment[]; onChange: (value: MediaAttachment[]) => void;
  mode?: MediaMode; primary?: boolean; kind?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const current = React.useRef(value);
  React.useEffect(() => { current.current = value; }, [value]);
  const [upload, setUpload] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [replace, setReplace] = React.useState<number | null>(null);
  const [error, setError] = React.useState("");
  const dragged = React.useRef<number | null>(null);
  const select = (asset: MediaAssetChoice) => {
    const rows = [...current.current];
    if (rows.some((row, index) => row.mediaId === asset.id && index !== replace)) { setError("This asset is already attached."); return; }
    setError("");
    const row: MediaAttachment = { mediaId: asset.id, url: asset.url, kind: asset.kind, mimeType: asset.mimeType, altText: asset.altText, caption: asset.caption, posterUrl: asset.posterUrl };
    if (replace !== null) { row.isCover = rows[replace]?.isCover && asset.mimeType.startsWith("image/"); rows[replace] = { ...rows[replace], ...row, altText: rows[replace]?.altText ?? row.altText, caption: rows[replace]?.caption ?? row.caption }; }
    else { row.isCover = primary && asset.mimeType.startsWith("image/") && !rows.some((item) => item.isCover); rows.push(row); }
    current.current = rows; onChange(rows);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const rows = [...value]; rows.splice(to, 0, rows.splice(from, 1)[0]); onChange(rows);
  };
  return <section aria-label={label} className="space-y-3 rounded-lg border p-3"><h4 className="font-medium">{label}</h4>
    <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setReplace(null); setUpload(true); }}>+ Upload files</Button><Button type="button" variant="outline" onClick={() => { setReplace(null); setPicker(true); }}>Choose Existing</Button></div>
    <p className="text-xs text-muted-foreground">Attachment changes are saved with this form. Removing an attachment preserves the asset in Media Library.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {upload && <MediaUploader mode={mode} kind={kind} multiple={replace === null} onUploaded={select} onBusyChange={onBusyChange} />}
    <MediaPicker open={picker} onOpenChange={setPicker} mode={mode} onSelect={select} />
    <ol className="grid gap-3 sm:grid-cols-2">{value.map((row, index) => <li key={row.mediaId} draggable onDragStart={() => { dragged.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragged.current !== null) move(dragged.current, index); dragged.current = null; }} className="space-y-2 rounded-lg border p-3">
      {row.url && <MediaPreview asset={{ url: row.url, mimeType: row.mimeType ?? (row.kind === "VIDEO" ? "video/mp4" : row.kind === "DOCUMENT" ? "application/pdf" : "image/jpeg"), altText: row.altText, posterUrl: row.posterUrl }} />}
      <p className="text-xs">{row.kind || "Media"}{row.isCover ? " · Cover / Primary" : ""}</p>
      {row.kind === "VIDEO" && <VideoPosterField mediaId={row.mediaId} onSaved={(posterUrl) => onChange(value.map((item, at) => at === index ? { ...item, posterUrl } : item))} />}
      {mode !== "document" && mode !== "floor-plan" && <><Input aria-label={"Caption for media " + (index + 1)} placeholder="Caption" value={row.caption ?? ""} maxLength={500} onChange={(event) => onChange(value.map((item, at) => at === index ? { ...item, caption: event.target.value } : item))} />
      <Input aria-label={"Alt text for media " + (index + 1)} placeholder="Alt text" value={row.altText ?? ""} maxLength={300} onChange={(event) => onChange(value.map((item, at) => at === index ? { ...item, altText: event.target.value } : item))} /></>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={index === 0} aria-label={"Move media " + (index + 1) + " up"} onClick={() => move(index, index - 1)}>Move up</Button>
        <Button type="button" variant="outline" size="sm" disabled={index === value.length - 1} aria-label={"Move media " + (index + 1) + " down"} onClick={() => move(index, index + 1)}>Move down</Button>
        {primary && row.kind !== "VIDEO" && row.kind !== "DOCUMENT" && <Button type="button" variant="outline" size="sm" onClick={() => onChange(value.map((item, at) => ({ ...item, isCover: at === index })))}>Set Cover</Button>}
        <Button type="button" variant="outline" size="sm" onClick={() => { setReplace(index); setUpload(true); }}>Replace</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setReplace(index); setPicker(true); }}>Choose replacement</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(value.filter((_, at) => at !== index))}>Remove</Button>
      </div>
    </li>)}</ol>
  </section>;
}

function VideoPosterField({ mediaId, onSaved }: { mediaId: string; onSaved: (url: string | null) => void }) {
  const [asset, setAsset] = React.useState<MediaAssetChoice | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    api.get<MediaAssetChoice>("/api/media/" + encodeURIComponent(mediaId)).then((result) => { if (active) setAsset(result); }).catch(() => { if (active) setError("Video poster could not be loaded."); });
    return () => { active = false; };
  }, [mediaId]);
  async function save(posterMediaId: string) {
    if (!asset?.updatedAt) return;
    setError("");
    try {
      await api.patch("/api/media/" + encodeURIComponent(mediaId), { expectedUpdatedAt: asset.updatedAt, altText: asset.altText ?? null, caption: asset.caption ?? null, posterMediaId: posterMediaId || null });
      const updated = await api.get<MediaAssetChoice>("/api/media/" + encodeURIComponent(mediaId));
      setAsset(updated); onSaved(updated.posterUrl ?? null);
    } catch (error) { setError(error instanceof Error ? error.message : "Poster could not be saved."); }
  }
  return <div><p className="text-xs text-muted-foreground">Poster changes update the video asset in Media Library wherever it is used.</p><MediaField label="Video poster" value={asset?.posterMediaId ?? ""} onChange={(id) => { void save(id); }} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}

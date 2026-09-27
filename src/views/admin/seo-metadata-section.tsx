"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/common";
import { History, Plus, RotateCcw } from "lucide-react";

interface SeoEntry {
  id: string; routeKey: string; title: string | null; description: string | null; canonicalPath: string | null;
  noindex: boolean; ogImageMediaId: string | null; priority: number | null; changefreq: string | null;
  updatedAt: string; revisionCount: number;
}
interface PublicImage { id: string; kind: string; isPrivate: boolean; altText: string | null }
interface SeoForm { routeKey: string; title: string; description: string; canonicalPath: string; noindex: boolean; ogImageMediaId: string; priority: string; changefreq: string }
interface Revision { id: string; version: number; snapshot: SeoForm; editedBy: string | null; changeNote: string | null; createdAt: string }
const emptyForm = (): SeoForm => ({ routeKey: "", title: "", description: "", canonicalPath: "", noindex: false, ogImageMediaId: "", priority: "", changefreq: "" });

function imageLabel(image: PublicImage) { return image.altText?.trim() || image.id; }
function formatDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"; }

export function SeoMetadataSection({ canEdit }: { canEdit: boolean }) {
  const [entries, setEntries] = React.useState<SeoEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [images, setImages] = React.useState<PublicImage[]>([]);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<SeoEntry | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<SeoForm>(emptyForm());
  const [saving, setSaving] = React.useState(false);
  const [historyTarget, setHistoryTarget] = React.useState<SeoEntry | null>(null);
  const [revisions, setRevisions] = React.useState<Revision[]>([]);
  const [restoring, setRestoring] = React.useState(false);

  const load = React.useCallback(() => {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    api.get<{ entries: SeoEntry[] }>(`/api/admin/seo-metadata${suffix}`)
      .then((result) => { setLoadFailed(false); setEntries(result.entries); })
      .catch(() => { setLoadFailed(true); setEntries([]); });
  }, [query]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (!canEdit) return;
    api.get<{ media: PublicImage[] }>("/api/media?take=100")
      .then((result) => setImages(result.media.filter((image) => !image.isPrivate && image.kind === "IMAGE")))
      .catch(() => setImages([]));
  }, [canEdit]);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(emptyForm()); };
  const openEdit = (entry: SeoEntry) => {
    setEditing(entry);
    setCreating(false);
    setForm({ routeKey: entry.routeKey, title: entry.title ?? "", description: entry.description ?? "", canonicalPath: entry.canonicalPath ?? "", noindex: entry.noindex, ogImageMediaId: entry.ogImageMediaId ?? "", priority: entry.priority?.toString() ?? "", changefreq: entry.changefreq ?? "" });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const input = {
        routeKey: form.routeKey,
        title: form.title || null,
        description: form.description || null,
        canonicalPath: form.canonicalPath || null,
        noindex: form.noindex,
        ogImageMediaId: form.ogImageMediaId || null,
        priority: form.priority ? Number(form.priority) : null,
        changefreq: form.changefreq || null,
      };
      if (editing) await api.patch("/api/admin/seo-metadata", { ...input, seoMetadataId: editing.id, expectedUpdatedAt: editing.updatedAt });
      else await api.post("/api/admin/seo-metadata", input);
      toast.success(editing ? "Route SEO metadata saved" : "Route SEO metadata created");
      setCreating(false);
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SEO metadata could not be saved");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setSaving(false); }
  };

  const openHistory = async (entry: SeoEntry) => {
    setHistoryTarget(entry);
    try {
      const result = await api.get<{ revisions: Revision[] }>(`/api/admin/seo-metadata/${encodeURIComponent(entry.id)}/revisions`);
      setRevisions(result.revisions);
    } catch { setRevisions([]); toast.error("SEO revision history could not be loaded"); }
  };

  const restore = async (revision: Revision) => {
    if (!historyTarget) return;
    setRestoring(true);
    try {
      await api.post(`/api/admin/seo-metadata/${encodeURIComponent(historyTarget.id)}/revisions`, { revisionId: revision.id, expectedUpdatedAt: historyTarget.updatedAt });
      toast.success("SEO metadata revision restored");
      setHistoryTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SEO revision could not be restored");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setRestoring(false); }
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold">SEO metadata</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Overrides affect server-rendered title, description, canonical URL, public Open Graph image, and the generated sitemap. Hreflang stays tied to actual published EN/AR content pairs; structured data is not editable here.</p></div>{canEdit && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add route metadata</Button>}</header>
    <Input className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search route key or title" aria-label="Search SEO metadata" />
    {entries === null ? <LoadingState rows={4} /> : loadFailed ? <EmptyState title="SEO metadata unavailable" description="The protected list could not be loaded. Try again." /> : entries.length === 0 ? <EmptyState title="No route overrides" description="The server uses its safe route defaults until a public route override is created." /> : <div className="overflow-x-safe rounded-xl border border-border/70">
      <table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Route key</th><th className="p-3">Title override</th><th className="p-3">Indexing</th><th className="p-3">Sitemap</th><th className="p-3">Updated</th><th className="p-3">Actions</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-border/50"><td className="p-3 font-mono text-xs">{entry.routeKey}</td><td className="max-w-sm p-3">{entry.title ?? <span className="text-muted-foreground">Route default</span>}</td><td className="p-3"><Badge variant="outline">{entry.noindex ? "NOINDEX" : "INDEXABLE"}</Badge></td><td className="p-3 text-xs">{entry.priority ?? "default"} · {entry.changefreq ?? "default"}</td><td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatDate(entry.updatedAt)}</td><td className="p-3"><div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={() => void openHistory(entry)}><History className="mr-1.5 h-3.5 w-3.5" />History</Button>{canEdit && <Button size="sm" variant="outline" onClick={() => openEdit(entry)}>Edit</Button>}</div></td></tr>)}</tbody>
      </table>
    </div>}

    {canEdit && <Dialog open={creating || editing !== null} onOpenChange={(open) => { if (!open && !saving) { setCreating(false); setEditing(null); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{creating ? "Add SEO route metadata" : "Edit SEO route metadata"}</DialogTitle><DialogDescription>Use a known public route key without leading slash (for example, “home”, “about”, or “guides/example-slug”). System/private pages are rejected. Empty values use the server-generated defaults.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <label className="block space-y-1.5 text-sm font-medium">Route key<Input required maxLength={300} pattern="[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*" value={form.routeKey} onChange={(event) => setForm({ ...form, routeKey: event.target.value })} placeholder="home or guides/example-slug" disabled={!creating} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Title override (optional)<Input maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Description override (optional)<Textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Canonical path override (optional)<Input maxLength={500} pattern="/[A-Za-z0-9._~/-]*" value={form.canonicalPath} onChange={(event) => setForm({ ...form, canonicalPath: event.target.value })} placeholder="/guides/example-slug" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span><span className="block font-medium">Noindex</span><span className="text-xs text-muted-foreground">Exclude from robots and sitemap.</span></span><Switch checked={form.noindex} onCheckedChange={(noindex) => setForm({ ...form, noindex })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Public Open Graph image<Select value={form.ogImageMediaId || "none"} onValueChange={(ogImageMediaId) => setForm({ ...form, ogImageMediaId: ogImageMediaId === "none" ? "" : ogImageMediaId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Use site default</SelectItem>{images.map((image) => <SelectItem key={image.id} value={image.id}>{imageLabel(image)}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">Sitemap priority (0–1)<Input type="number" min={0} max={1} step={0.1} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Sitemap change frequency<Select value={form.changefreq || "default"} onValueChange={(changefreq) => setForm({ ...form, changefreq: changefreq === "default" ? "" : changefreq })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Use default</SelectItem>{["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].map((freq) => <SelectItem key={freq} value={freq}>{freq}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create route metadata" : "Save changes"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}

    <Dialog open={historyTarget !== null} onOpenChange={(open) => { if (!open && !restoring) setHistoryTarget(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>SEO metadata history</DialogTitle><DialogDescription>Restore a complete prior field snapshot. Every restore creates a new version and audit entry.</DialogDescription></DialogHeader>
        {revisions.length ? <div className="space-y-3">{revisions.map((revision) => <article key={revision.id} className="rounded-lg border border-border/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><Badge variant="outline">Revision {revision.version}</Badge><p className="mt-1 text-xs text-muted-foreground">{formatDate(revision.createdAt)} · {revision.changeNote ?? "No note"}</p></div>{canEdit && <Button size="sm" variant="outline" disabled={restoring} onClick={() => void restore(revision)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Restore</Button>}</div><p className="mt-3 text-sm font-medium">{revision.snapshot?.title || "Route default title"}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{revision.snapshot?.routeKey}</p><p className="mt-1 text-xs text-muted-foreground">{revision.snapshot?.canonicalPath || "Default canonical"} · {revision.snapshot?.noindex ? "noindex" : "indexable"}</p></article>)}</div> : <EmptyState title="No revisions found" description="History appears after metadata is created or changed." />}
        <DialogFooter><Button variant="outline" onClick={() => setHistoryTarget(null)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

"use client";
import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type Preview = { previewToken: string; properties: { id: string; title: string; listingCount: number }[]; effect: string };
export function DemoCleanupStudio({ properties, onSaved }: { properties: Record<string, unknown>[]; onSaved: () => void }) {
  const candidates = properties.filter(p => p.canManage && (p.isDemoData || p.sourceType === "DEMO_SEED") && p.publicationStatus !== "ARCHIVED");
  const version = candidates.map(p => `${p.id}:${p.updatedAt}`).join("|");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => { setSelected([]); setPreview(null); }, [version]);
  async function submit(mode: "preview" | "archive") {
    setBusy(true); setMessage("");
    try {
      const result = await api.post<Preview>("/api/admin/properties/demo-cleanup", { mode, propertyIds: selected, previewToken: preview?.previewToken });
      if (mode === "preview") setPreview(result);
      else { setPreview(null); setSelected([]); setMessage("Selected demo properties archived. Media and people were preserved."); onSaved(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cleanup could not complete. Retry or refresh the preview."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border p-4">
    <summary className="cursor-pointer font-medium">Review demo cleanup</summary>
    <p className="my-3 text-sm text-muted-foreground">Select demo properties from this page. Review the exact selection before archiving. People, projects and reusable media are retained.</p>
    <div className="space-y-2">{candidates.length === 0 ? <p className="text-sm">No editable demo records on this page.</p> : candidates.map(p => <label key={String(p.id)} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={selected.includes(String(p.id))} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? [...previous, String(p.id)] : previous.filter(id => id !== String(p.id))); }} />{String(p.title)}</label>)}</div>
    <Button className="mt-3" variant="outline" disabled={busy || selected.length === 0} onClick={() => submit("preview")}>{busy ? "Working…" : "Preview selected demo records"}</Button>
    {preview && <div className="mt-4 space-y-3 rounded-lg border p-3"><p className="text-sm">{preview.effect}</p><ul className="list-disc pl-5 text-sm">{preview.properties.map(p => <li key={p.id}>{p.title} · {p.listingCount} listings</li>)}</ul><Button disabled={busy} onClick={() => submit("archive")}>Archive these reviewed demo records</Button></div>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </details>;
}

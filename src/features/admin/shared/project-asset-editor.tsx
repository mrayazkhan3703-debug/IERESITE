"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Asset = { id: string; mimeType: string; altText: string | null };
type Doc = { id: string; mediaId: string; docType: string; label: string | null; gated: boolean; mimeType: string };

export function ProjectAssetEditor({ projectId, documents: initialDocuments, onChanged }: { projectId: string; documents: Doc[]; onChanged?: () => void }) {
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [documents, setDocuments] = React.useState(initialDocuments);
  const [mediaId, setMediaId] = React.useState("");
  const [docType, setDocType] = React.useState("BROCHURE");
  const [label, setLabel] = React.useState("");
  const [gated, setGated] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setDocuments(initialDocuments); }, [initialDocuments]);
  React.useEffect(() => { api.get<{ media: Asset[] }>("/api/media?take=100").then((data) => setAssets(data.media.filter((asset) => asset.mimeType === "application/pdf"))).catch(() => setAssets([])); }, []);

  const mutate = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.post("/api/admin/projects/assets", { projectId, ...payload });
      const next = await api.get<{ projects: Record<string, unknown>[] }>("/api/admin/projects");
      const updated = next.projects.find((project) => project.id === projectId);
      if (updated && Array.isArray(updated.documents)) setDocuments(updated.documents as Doc[]);
      onChanged?.();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Project document update failed"); return false; }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!mediaId) return;
    if (await mutate({ action: "add-document", mediaId, docType, label: label || null, gated })) {
      setMediaId(""); setLabel(""); toast.success("Project document attached");
    }
  };

  return <section className="space-y-3 rounded-lg border border-border/70 p-3">
    <div><h3 className="text-sm font-semibold">Project documents</h3><p className="text-xs text-muted-foreground">Attach public PDF brochures and project documents. Gate downloads that require lead capture.</p></div>
    <div className="grid gap-2 sm:grid-cols-2">
      <Select value={mediaId} onValueChange={setMediaId}><SelectTrigger aria-label="Select project PDF"><SelectValue placeholder="Choose PDF from Media Library" /></SelectTrigger><SelectContent>{assets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.altText || asset.id.slice(0, 18)}</SelectItem>)}</SelectContent></Select>
      <Select value={docType} onValueChange={setDocType}><SelectTrigger aria-label="Project document type"><SelectValue /></SelectTrigger><SelectContent>{["BROCHURE", "FLOOR_PLAN_PACK", "ESCALATION", "OTHER"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
      <Input value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} placeholder="Document label" aria-label="Project document label" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gated} onChange={(event) => setGated(event.target.checked)} />Require lead capture</label>
      <Button type="button" variant="outline" disabled={busy || !mediaId} onClick={add}>Attach document</Button>
    </div>
    {documents.length ? <ul className="space-y-2">{documents.map((document) => <li key={document.id} className="flex items-center gap-2 rounded border border-border/60 p-2 text-xs"><span className="flex-1">{document.label || document.docType} · {document.gated ? "Gated" : "Public download"}</span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => { if (await mutate({ action: "remove-document", id: document.id })) toast.success("Project document removed"); }}>Remove</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">No project documents attached.</p>}
  </section>;
}

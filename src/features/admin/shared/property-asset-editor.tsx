"use client";

import * as React from "react";
import Image from "next/image";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Asset = { id: string; kind: string; mimeType: string; url: string; altText: string | null };
type FloorPlan = { id: string; mediaId: string; bedrooms: number | null; areaSqft: number | null; priceMinor: string | null; label: string | null; url: string };
type DocumentItem = { id: string; mediaId: string; docType: string; label: string | null; gated: boolean; url: string; mimeType: string };

export function PropertyAssetEditor({ propertyId, floorPlans, documents, onChanged }: {
  propertyId: string; floorPlans: FloorPlan[]; documents: DocumentItem[]; onChanged?: () => void;
}) {
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [floorMediaId, setFloorMediaId] = React.useState("");
  const [floorBedrooms, setFloorBedrooms] = React.useState("");
  const [floorArea, setFloorArea] = React.useState("");
  const [floorPrice, setFloorPrice] = React.useState("");
  const [floorLabel, setFloorLabel] = React.useState("");
  const [documentMediaId, setDocumentMediaId] = React.useState("");
  const [docType, setDocType] = React.useState("BROCHURE");
  const [docLabel, setDocLabel] = React.useState("");
  const [gated, setGated] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { api.get<{ media: Asset[] }>("/api/media?take=100").then((data) => setAssets(data.media)).catch(() => setAssets([])); }, []);
  const mutate = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try { await api.post("/api/admin/properties/media", { propertyId, ...payload }); onChanged?.(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Property media update failed"); return false; }
    finally { setBusy(false); }
  };
  const addFloorPlan = async () => {
    if (!floorMediaId) return;
    if (await mutate({ action: "add-floor-plan", mediaId: floorMediaId, bedrooms: floorBedrooms ? Number(floorBedrooms) : null, areaSqft: floorArea ? Number(floorArea) : null, priceAed: floorPrice ? Number(floorPrice) : null, label: floorLabel || null })) {
      toast.success("Floor plan added"); setFloorMediaId(""); setFloorBedrooms(""); setFloorArea(""); setFloorPrice(""); setFloorLabel("");
    }
  };
  const addDocument = async () => {
    if (!documentMediaId) return;
    if (await mutate({ action: "add-document", mediaId: documentMediaId, docType, label: docLabel || null, gated })) { toast.success("Property document added"); setDocumentMediaId(""); setDocLabel(""); }
  };

  return <div className="space-y-4 rounded-lg border border-border/70 p-3">
    <section className="space-y-2"><h3 className="text-sm font-semibold">Floor plans</h3><div className="grid gap-2 sm:grid-cols-2">
      <Select value={floorMediaId} onValueChange={setFloorMediaId}><SelectTrigger aria-label="Select floor plan"><SelectValue placeholder="Choose image or PDF" /></SelectTrigger><SelectContent>{assets.filter((asset) => asset.kind === "FLOOR_PLAN" || asset.mimeType.startsWith("image/") || asset.mimeType === "application/pdf").map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.altText || asset.id.slice(0, 18)} · {asset.mimeType}</SelectItem>)}</SelectContent></Select>
      <Input aria-label="Floor plan label" placeholder="Label, e.g. Type A" value={floorLabel} maxLength={160} onChange={(event) => setFloorLabel(event.target.value)} />
      <Input aria-label="Floor plan bedrooms" type="number" min="0" max="30" step="0.5" placeholder="Bedrooms" value={floorBedrooms} onChange={(event) => setFloorBedrooms(event.target.value)} />
      <Input aria-label="Floor plan area" type="number" min="0.01" placeholder="Area (sq ft)" value={floorArea} onChange={(event) => setFloorArea(event.target.value)} />
      <Input aria-label="Floor plan price" type="number" min="0.01" placeholder="Price (AED, optional)" value={floorPrice} onChange={(event) => setFloorPrice(event.target.value)} />
      <Button type="button" variant="outline" onClick={addFloorPlan} disabled={busy || !floorMediaId}>Add floor plan</Button>
    </div>{floorPlans.length ? <ul className="space-y-2">{floorPlans.map((item) => <li key={item.id} className="flex items-center gap-2 rounded border border-border/60 p-2 text-xs">{item.url && <Image src={item.url} alt="" width={72} height={48} unoptimized className="h-12 w-[72px] rounded object-cover" />}<span className="flex-1">{item.label || "Floor plan"} · {item.bedrooms ?? "—"} beds · {item.areaSqft ?? "—"} sqft</span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => { if (await mutate({ action: "remove-floor-plan", id: item.id })) toast.success("Floor plan removed"); }}>Remove</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">No floor plans assigned.</p>}</section>
    <section className="space-y-2 border-t border-border/60 pt-3"><h3 className="text-sm font-semibold">Documents and brochures</h3><div className="grid gap-2 sm:grid-cols-2">
      <Select value={documentMediaId} onValueChange={setDocumentMediaId}><SelectTrigger aria-label="Select document"><SelectValue placeholder="Choose a PDF asset" /></SelectTrigger><SelectContent>{assets.filter((asset) => asset.mimeType === "application/pdf").map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.altText || asset.id.slice(0, 18)}</SelectItem>)}</SelectContent></Select>
      <Select value={docType} onValueChange={(value) => { setDocType(value); if (value === "TITLE_DEED") setGated(true); }}><SelectTrigger aria-label="Document type"><SelectValue /></SelectTrigger><SelectContent>{["BROCHURE", "FLOOR_PLAN_PACK", "TITLE_DEED", "ESCALATION", "OTHER"].map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
      <Input aria-label="Document label" placeholder="Document label" value={docLabel} maxLength={160} onChange={(event) => setDocLabel(event.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gated} disabled={docType === "TITLE_DEED"} onChange={(event) => setGated(event.target.checked)} />Require lead capture to download{docType === "TITLE_DEED" && <span className="text-xs text-muted-foreground">(required for title deeds)</span>}</label>
      <Button type="button" variant="outline" onClick={addDocument} disabled={busy || !documentMediaId}>Add document</Button>
    </div>{documents.length ? <ul className="space-y-2">{documents.map((item) => <li key={item.id} className="flex items-center gap-2 rounded border border-border/60 p-2 text-xs"><span className="flex-1">{item.label || item.docType} · {item.gated ? "Gated" : "Public download"}</span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => { if (await mutate({ action: "remove-document", id: item.id })) toast.success("Document removed"); }}>Remove</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">No property documents assigned.</p>}</section>
  </div>;
}

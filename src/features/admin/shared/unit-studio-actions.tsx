"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toMinor } from "@/lib/money";

export type UnitRow = {
  id: string; unitNumber: string | null; unitType: string; bedrooms: number; bathrooms: number;
  areaSqft: number | null; priceMinor: string | null; currency: string; availabilityStatus: string;
  floor: number | null; aspect: string | null; projectId: string | null; propertyId: string | null;
  sourceType: string; sourceKey: string | null; sourceSnapshot: Record<string, unknown>; editorOverrides: Record<string, unknown>;
  updatedAt: string; statusHistory: { fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }[];
};
export type UnitProject = { id: string; name: string; slug: string; unitCount: number };
export type UnitProperty = { id: string; title: string; projectId: string | null };

const blankUnit = (projectId: string) => ({ projectId, propertyId: "none", unitNumber: "", unitType: "APARTMENT", bedrooms: "0", bathrooms: "1", areaSqft: "", price: "", currency: "AED", availabilityStatus: "AVAILABLE", floor: "", aspect: "", changeReason: "" });

export function UnitEditorDialog({ open, onOpenChange, unit, projects, properties, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void; unit: UnitRow | null; projects: UnitProject[]; properties: UnitProperty[]; onChanged: () => void;
}) {
  const [form, setForm] = React.useState(blankUnit(projects[0]?.id ?? ""));
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setForm(unit ? { projectId: unit.projectId ?? "", propertyId: unit.propertyId ?? "none", unitNumber: unit.unitNumber ?? "", unitType: unit.unitType, bedrooms: String(unit.bedrooms), bathrooms: String(unit.bathrooms), areaSqft: unit.areaSqft == null ? "" : String(unit.areaSqft), price: unit.priceMinor == null ? "" : String(Number(unit.priceMinor) / 100), currency: unit.currency, availabilityStatus: unit.availabilityStatus, floor: unit.floor == null ? "" : String(unit.floor), aspect: unit.aspect ?? "", changeReason: "" } : blankUnit(projects[0]?.id ?? ""));
  }, [open, unit, projects]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const values = {
        ...form, propertyId: form.propertyId === "none" ? null : form.propertyId,
        unitNumber: form.unitNumber || null, bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms),
        areaSqft: form.areaSqft ? Number(form.areaSqft) : null, priceMinor: form.price ? toMinor(form.price).toString() : null,
        currency: form.currency.toUpperCase(), floor: form.floor ? Number(form.floor) : null,
        aspect: form.aspect || null, changeReason: form.changeReason || null,
      };
      if (unit) await api.patch("/api/admin/units", { ...values, unitId: unit.id, expectedUpdatedAt: unit.updatedAt });
      else await api.post("/api/admin/units", values);
      toast.success(unit ? "Unit updated" : "Unit created"); onOpenChange(false); onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unit could not be saved"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!unit || unit.sourceType !== "MANUAL" || !window.confirm(`Delete manually managed unit ${unit.unitNumber ?? unit.id}?`)) return;
    setBusy(true);
    try { await api.delete("/api/admin/units", { unitId: unit.id, expectedUpdatedAt: unit.updatedAt }); toast.success("Unit deleted"); onOpenChange(false); onChanged(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unit could not be deleted"); }
    finally { setBusy(false); }
  };
  const relatedProperties = properties.filter((property) => property.projectId === form.projectId);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{unit ? "Edit unit" : "Add unit"}</DialogTitle><DialogDescription>{unit?.sourceType === "IMPORT" ? "Imported source facts are preserved. These changes are saved as editorial overrides and will survive the next import." : "Manual inventory updates are version checked, audited, and included in availability history."}</DialogDescription></DialogHeader>
    {unit?.sourceType === "IMPORT" && <details className="rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">Imported source and override details</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify({ sourceKey: unit.sourceKey, sourceSnapshot: unit.sourceSnapshot, editorOverrides: unit.editorOverrides }, null, 2)}</pre></details>}
    <form className="space-y-3" onSubmit={save}>
      <label className="block space-y-1.5 text-sm font-medium">Project<Select required value={form.projectId} disabled={Boolean(unit)} onValueChange={(projectId) => setForm({ ...form, projectId, propertyId: "none" })}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="block space-y-1.5 text-sm font-medium">Linked property (optional)<Select value={form.propertyId} onValueChange={(propertyId) => setForm({ ...form, propertyId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No property linked</SelectItem>{relatedProperties.map((property) => <SelectItem key={property.id} value={property.id}>{property.title}</SelectItem>)}</SelectContent></Select></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Unit number<Input maxLength={100} value={form.unitNumber} onChange={(e) => setForm({ ...form, unitNumber: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Unit type<Input required maxLength={60} value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Bedrooms<Input type="number" min="0" max="30" step="0.5" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Bathrooms<Input type="number" min="0" max="30" step="0.5" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Area sqft<Input type="number" min="0.01" max="100000000" step="0.01" value={form.areaSqft} onChange={(e) => setForm({ ...form, areaSqft: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Price<Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Currency<Input required maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
        <label className="space-y-1 text-sm">Floor<Input type="number" min="-10" max="300" step="1" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Aspect / view<Input maxLength={160} value={form.aspect} onChange={(e) => setForm({ ...form, aspect: e.target.value })} /></label>
        <label className="space-y-1 text-sm">Availability<Select value={form.availabilityStatus} onValueChange={(availabilityStatus) => setForm({ ...form, availabilityStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
      </div>
      <label className="block space-y-1.5 text-sm">Reason for availability change (optional)<Input maxLength={500} value={form.changeReason} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} /></label>
      {unit?.statusHistory.length ? <section className="space-y-1 rounded border p-2 text-xs"><h3 className="font-medium">Availability history</h3>{unit.statusHistory.map((history, index) => <p key={`${history.createdAt}-${index}`}>{history.fromStatus ?? "Created"} → {history.toStatus} · {new Date(history.createdAt).toLocaleString()}{history.reason ? ` · ${history.reason}` : ""}</p>)}</section> : null}
      <DialogFooter className="gap-2 sm:justify-between">{unit?.sourceType === "MANUAL" ? <Button type="button" variant="destructive" disabled={busy} onClick={remove}>Delete manual unit</Button> : <span /> }<div className="flex gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !form.projectId}>{busy ? "Saving…" : unit ? "Save unit" : "Create unit"}</Button></div></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

type ImportPreview = { total: number; creates: number; updates: number; unchanged: number; conflicts: number; rows: { externalId: string; unitNumber: string | null; action: string; changedFields: string[] }[] };

export function UnitImportDialog({ open, onOpenChange, projects, defaultProjectId, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; projects: UnitProject[]; defaultProjectId: string; onChanged: () => void }) {
  const [projectId, setProjectId] = React.useState(defaultProjectId);
  const [csv, setCsv] = React.useState("externalId,unitNumber,unitType,bedrooms,bathrooms,areaSqft,priceMinor,currency,availabilityStatus,floor,aspect\n");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setProjectId(defaultProjectId); setPreview(null); } }, [open, defaultProjectId]);
  const readFile = async (file?: File) => { if (!file) return; setCsv(await file.text()); setPreview(null); };
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const result = await api.post<ImportPreview>("/api/admin/units/import", { projectId, format: "csv", data: csv, dryRun });
      if (dryRun) { setPreview(result); toast.success(`Preview ready: ${result.creates} create, ${result.updates} update, ${result.conflicts} conflict`); }
      else { toast.success("Unit import applied"); onOpenChange(false); onChanged(); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unit import failed"); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>Import unit inventory</DialogTitle><DialogDescription>Upload CSV, review the dry-run diff, then apply. Required columns: externalId, unitType, bedrooms, bathrooms. Imported feed facts remain recorded separately from Admin overrides.</DialogDescription></DialogHeader>
    <label className="block space-y-1.5 text-sm font-medium">Project<Select value={projectId} onValueChange={(value) => { setProjectId(value); setPreview(null); }}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></label>
    <label className="block space-y-1.5 text-sm font-medium">CSV file<input className="block w-full text-sm" type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
    <label className="block space-y-1.5 text-sm font-medium">CSV data<textarea className="min-h-44 w-full rounded-md border border-input bg-background p-3 font-mono text-xs" value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} /></label>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button type="button" variant="outline" disabled={busy || !projectId} onClick={() => void run(true)}>{busy ? "Working…" : "Preview import"}</Button>{preview && <Button type="button" disabled={busy || preview.conflicts > 0 || preview.total === 0} onClick={() => void run(false)}>{busy ? "Applying…" : "Apply import"}</Button>}</div>
    {preview && <section className="space-y-2 rounded border p-3"><p className="text-sm font-medium">{preview.total} row(s): {preview.creates} create · {preview.updates} update · {preview.unchanged} unchanged · {preview.conflicts} conflict</p>{preview.conflicts > 0 && <p className="text-xs text-destructive">Resolve unit-number collisions with manual rows or duplicate values before applying.</p>}<div className="max-h-56 overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left"><th className="p-1">External ID</th><th className="p-1">Unit</th><th className="p-1">Action</th><th className="p-1">Changed source fields</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.externalId} className="border-b"><td className="p-1">{row.externalId}</td><td className="p-1">{row.unitNumber ?? "—"}</td><td className="p-1">{row.action}</td><td className="p-1">{row.changedFields.join(", ") || "—"}</td></tr>)}</tbody></table></div></section>}
  </DialogContent></Dialog>;
}

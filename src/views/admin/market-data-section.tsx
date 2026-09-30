"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { MARKET_FIELDS, type MarketSourceInput } from "@/lib/market-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Source { id: string; name: string; updatedAt: string; isActive: boolean; freshness: string; config: MarketSourceInput }
interface Run { id: string; source: string; status: string; datasetKind: string; recordsTotal: number; recordsCreated: number; recordsUpdated: number; recordsFailed: number; duplicatesDetected: number; snapshotSha256: string; snapshotRetrievedAt: string; appliedAt: string | null; appliedBy: string | null; createdAt: string }
interface RunDetail extends Run { records: { id: string; row: number; action: string; key: string; details: { plannedAction?: string; errors?: string[]; warnings?: string[]; before?: Record<string, unknown>; after?: Record<string, unknown> } }[] }
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const defaultSource = (): MarketSourceInput => ({ name: "", url: "", notes: "", datasetKind: "MARKET_TRANSACTION", mapping: { externalId: "externalId", date: "date", areaName: "areaName", propertyType: "propertyType", amountAed: "amountAed" }, staleAfterDays: 90, isIllustrative: true, isActive: true });

export function MarketDataSection({ canManage }: { canManage: boolean }) {
  const [data, setData] = React.useState<{ sources: Source[]; runs: Run[]; metricCount: number } | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<Source | null>(null);
  const [form, setForm] = React.useState<MarketSourceInput>(defaultSource);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [sourceId, setSourceId] = React.useState("");
  const [file, setFile] = React.useState<{ name: string; data: string; format: "CSV" | "JSON"; headers: string[]; total: number } | null>(null);
  const [retrievedAt, setRetrievedAt] = React.useState("");
  const [detail, setDetail] = React.useState<RunDetail | null>(null);
  const [reviewed, setReviewed] = React.useState(false);
  const requestKey = React.useRef<{ input: string; key: string } | null>(null);
  const load = React.useCallback(async () => {
    try { setData(await api.get("/api/admin/market-data")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Market operations could not be loaded."); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed."); }
    finally { setBusy(false); }
  };
  const showRun = async (id: string) => { setReviewed(false); setDetail((await api.get<{ run: RunDetail }>(`/api/admin/market-data?run=${encodeURIComponent(id)}`)).run); };
  const upload = (selected: File | undefined) => action(async () => {
    setFile(null);
    if (!selected) return;
    if (selected.size > 2 * 1024 * 1024 || !/\.(csv|json)$/i.test(selected.name)) throw new Error("Choose a CSV or JSON file no larger than 2 MiB.");
    const format = /\.json$/i.test(selected.name) ? "JSON" as const : "CSV" as const;
    const content = await selected.text();
    const result = await api.post<{ headers: string[]; total: number }>("/api/admin/market-data", { action: "inspect", format, data: content });
    setFile({ name: selected.name, data: content, format, ...result });
    setDetail(null);
  });
  const saveSource = (e: React.FormEvent) => {
    e.preventDefault();
    void action(async () => {
      const saved = await api.post<Source>("/api/admin/market-data", { action: "source", source: form, ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}) });
      setSourceId(saved.id); setSourceOpen(false); await load(); toast.success("Source and column mapping saved");
    });
  };
  const validate = () => action(async () => {
    if (!file || !sourceId || !retrievedAt) throw new Error("Choose a source, file and source retrieval date.");
    const input = { sourceId, format: file.format, data: file.data, retrievedAt: new Date(retrievedAt).toISOString() };
    const fingerprint = JSON.stringify(input);
    if (requestKey.current?.input !== fingerprint) requestKey.current = { input: fingerprint, key: crypto.randomUUID() };
    const result = await api.post<{ importRunId: string }>("/api/admin/market-data", { action: "validate", ...input, idempotencyKey: requestKey.current!.key });
    await showRun(result.importRunId); await load(); toast.success("Validation recorded; review the row results");
  });
  const apply = () => action(async () => {
    if (!detail || !reviewed) return;
    await api.post("/api/admin/market-data", { action: "apply", runId: detail.id, expectedSha256: detail.snapshotSha256, confirmSourceReviewed: true });
    await showRun(detail.id); await load(); toast.success("Reviewed dataset applied to the public explorers");
  });
  const chosen = data?.sources.find((s) => s.id === sourceId);
  return <section className="space-y-5" aria-labelledby="market-data-title">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="kicker">Market Intelligence operations</p><h2 id="market-data-title" className="mt-1 font-display text-2xl font-semibold">Source → validate → review → apply</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Upload sourced transactions or annual rents. Review the exact changes before they reach the public explorers. Source claims remain editorially reviewed; the platform does not certify the dataset.</p></div><Button variant="outline" onClick={() => void load()} disabled={busy}>Refresh market operations</Button></header>
    {error && <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{error}</p>}
    {!data && !error && <p role="status">Loading market operations…</p>}
    {data && <>
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Source registry</h3>{canManage && <Button onClick={() => { setEditing(null); setForm(defaultSource()); setSourceOpen(true); }}>Register market source</Button>}</div>
        {!data.sources.length && <p className="mt-3 text-sm text-muted-foreground">No market sources registered. Add the publisher, source URL, methodology and column mapping from your verified export.</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">{data.sources.map((source) => <article key={source.id} className="rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><h4 className="font-medium">{source.name}</h4><Badge variant="outline">{source.isActive ? source.freshness : "INACTIVE"}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{source.config.datasetKind.replace("MARKET_", "")} · {source.config.isIllustrative ? "Illustrative" : "Source review required"} · {source.config.staleAfterDays}-day freshness window</p><a href={source.config.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs underline">Source publisher</a>{canManage && <Button size="sm" variant="outline" className="mt-3" onClick={() => { setEditing(source); setForm(source.config); setSourceOpen(true); }}>Edit source and mapping</Button>}</article>)}</div>
      </div>
      {sourceOpen && canManage && <form onSubmit={saveSource} className="space-y-4 rounded-xl border bg-card p-5" aria-label="Market source editor">
        <h3 className="font-semibold">{editing ? "Edit market source" : "Register market source"}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="market-source-name">Publisher / source name</Label><Input id="market-source-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label htmlFor="market-source-url">Public source URL</Label><Input id="market-source-url" required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          <div><Label htmlFor="market-source-kind">Dataset</Label><select id="market-source-kind" className={selectClass} value={form.datasetKind} onChange={(e) => setForm({ ...form, datasetKind: e.target.value as MarketSourceInput["datasetKind"] })}><option value="MARKET_TRANSACTION">Transactions (AED)</option><option value="MARKET_RENT">Annual rents (AED/year)</option></select></div>
          <div><Label htmlFor="market-source-days">Freshness window (days)</Label><Input id="market-source-days" type="number" min={1} max={365} required value={form.staleAfterDays} onChange={(e) => setForm({ ...form, staleAfterDays: Number(e.target.value) })} /></div>
        </div>
        <div><Label htmlFor="market-source-notes">Methodology and dataset review notes</Label><Textarea id="market-source-notes" required minLength={10} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        <fieldset className="rounded-lg border p-4"><legend className="px-2 text-sm font-semibold">Column mapping</legend><p className="mb-3 text-xs text-muted-foreground">Enter the exact export header, or upload a file first to choose its columns. Amount is AED; rents must be annual. Date is YYYY-MM-DD. Optional communitySlug links a registered community for derived metrics.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{MARKET_FIELDS.map((field) => <div key={field}><Label htmlFor={`market-map-${field}`}>{field}{["externalId", "date", "areaName", "propertyType", "amountAed"].includes(field) ? " *" : ""}</Label><Input id={`market-map-${field}`} list="market-file-headers" value={form.mapping[field] ?? ""} onChange={(e) => { const mapping = { ...form.mapping }; if (e.target.value) mapping[field] = e.target.value; else delete mapping[field]; setForm({ ...form, mapping }); }} required={["externalId", "date", "areaName", "propertyType", "amountAed"].includes(field)} /></div>)}</div><datalist id="market-file-headers">{file?.headers.map((h) => <option key={h} value={h} />)}</datalist></fieldset>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.isIllustrative} onChange={(e) => setForm({ ...form, isIllustrative: e.target.checked })} />Illustrative dataset (keep enabled for samples or simulations)</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Source active</label>
        <div className="flex gap-2"><Button disabled={busy} type="submit">Save source mapping</Button><Button type="button" variant="outline" onClick={() => setSourceOpen(false)}>Cancel source edit</Button></div>
      </form>}
      {canManage && <div className="space-y-4 rounded-xl border bg-card p-5"><h3 className="font-semibold">Upload and validate a dataset</h3><div className="grid gap-4 sm:grid-cols-3"><div><Label htmlFor="market-upload-source">Registered source</Label><select id="market-upload-source" className={selectClass} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setDetail(null); }}><option value="">Choose source</option>{data.sources.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div><Label htmlFor="market-upload-file">CSV / JSON file (max 500 rows)</Label><Input id="market-upload-file" type="file" accept=".csv,.json" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /></div><div><Label htmlFor="market-retrieved-at">Source retrieval date</Label><Input id="market-retrieved-at" type="datetime-local" value={retrievedAt} onChange={(e) => setRetrievedAt(e.target.value)} /></div></div>{file && <p className="text-sm">{file.name} · {file.total} rows · columns: {file.headers.join(", ")}</p>}{chosen && <p className="text-xs text-muted-foreground">{chosen.config.notes} · {chosen.config.isIllustrative ? "Illustrative records" : "Review source authenticity before applying"}</p>}<Button variant="outline" onClick={() => void validate()} disabled={busy || !file || !sourceId || !retrievedAt}>Validate market file only</Button><p className="text-xs text-muted-foreground">Validation archives the uploaded file privately and records a preview. Public rows are changed only by Apply.</p></div>}
      <div className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Dataset history</h3>{!data.runs.length && <p className="mt-3 text-sm text-muted-foreground">No uploaded market datasets yet.</p>}<div className="mt-3 space-y-2">{data.runs.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{run.source} <Badge variant="outline">{run.status}</Badge></p><p className="mt-1 text-xs text-muted-foreground">{run.recordsTotal} rows · {run.recordsCreated} created · {run.recordsUpdated} updated · {run.recordsFailed} rejects · {run.duplicatesDetected} unchanged</p><p className="mt-1 text-xs text-muted-foreground">Retrieved {new Date(run.snapshotRetrievedAt).toLocaleDateString()} · {run.appliedAt ? `Applied ${new Date(run.appliedAt).toLocaleString()}` : "Not applied"}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void action(() => showRun(run.id))}>Review dataset</Button></div>)}</div></div>
      {detail && <div className="space-y-4 rounded-xl border bg-card p-5"><h3 className="font-semibold">Row review · {detail.status}</h3><p className="break-all text-xs text-muted-foreground">Snapshot SHA-256: {detail.snapshotSha256}</p><p className="text-sm">{detail.recordsFailed ? "Correct every rejected row in the source file, then upload and validate again." : detail.appliedAt ? "Applied dataset. This history preserves the validated changes." : "Inspect changed fields and source evidence before applying."}</p><div className="max-h-[480px] overflow-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr><th className="p-2">Row / source ID</th><th className="p-2">Outcome</th><th className="p-2">Changes / reasons</th></tr></thead><tbody>{detail.records.map((r) => <tr key={r.id} className="border-t"><td className="p-2">{r.row}<span className="block max-w-60 break-all text-xs text-muted-foreground">{r.key}</span></td><td className="p-2">{r.details.plannedAction ?? r.action}</td><td className="p-2">{r.details.errors?.map((e) => <p key={e} className="text-destructive">{e}</p>)}{r.details.warnings?.map((e) => <p key={e} className="text-muted-foreground">{e}</p>)}{r.details.after && <details><summary className="cursor-pointer">Inspect changed fields</summary><dl className="mt-2 space-y-1 text-xs">{Object.entries(r.details.after).filter(([k, v]) => k !== "rawPayloadJson" && JSON.stringify(r.details.before?.[k]) !== JSON.stringify(v)).map(([k, v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd className="break-all">{String(r.details.before?.[k] ?? "—")} → {String(v ?? "—")}</dd></div>)}</dl></details>}</td></tr>)}</tbody></table></div>{canManage && detail.status === "VALIDATED" && !detail.appliedAt && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the source, dates and proposed changes for this dataset.</label><Button onClick={() => void apply()} disabled={busy || !reviewed}>Apply reviewed market dataset</Button></>}</div>}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"><div><h3 className="font-semibold">Derived metrics</h3><p className="mt-1 text-sm text-muted-foreground">{data.metricCount} stored metrics. Rebuild computes monthly sales counts, median prices, price per square foot and one-bedroom annual rents from current eligible observations. Curated metrics are preserved; samples never mix with actual observations.</p></div>{canManage && <Button variant="outline" disabled={busy} onClick={() => void action(async () => { const result = await api.post<{ count: number; preserved: number }>("/api/admin/market-data", { action: "rebuild" }); await load(); toast.success(`${result.count} metrics rebuilt; ${result.preserved} existing keys preserved`); })}>Rebuild market metrics</Button>}</div>
    </>}
  </section>;
}

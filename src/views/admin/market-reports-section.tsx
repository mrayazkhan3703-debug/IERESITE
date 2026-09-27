"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/common";
import { Clock, FileText, History, Plus, RotateCcw } from "lucide-react";

interface MarketReport {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  periodLabel: string | null;
  methodology: string | null;
  dataSourceName: string | null;
  dataSourceUrl: string | null;
  retrievedAt: string | null;
  body: string;
  coverMediaId: string | null;
  fileMediaId: string | null;
  status: string;
  reviewWorkflowState: string;
  isIllustrative: boolean;
  gated: boolean;
  publishedAt: string | null;
  updatedAt: string;
  revisionCount: number;
}

interface ReportForm {
  slug: string; title: string; summary: string; periodLabel: string; methodology: string;
  dataSourceName: string; dataSourceUrl: string; retrievedAt: string; body: string;
  coverMediaId: string; fileMediaId: string; gated: boolean; isIllustrative: boolean; submitForReview: boolean;
}

interface PublicMedia { id: string; kind: string; isPrivate: boolean; altText: string | null; url: string }
interface ReportRevision { id: string; version: number; changeNote: string | null; createdAt: string; editedBy: string | null; snapshot: Record<string, unknown> | null }

const emptyForm = (): ReportForm => ({
  slug: "", title: "", summary: "", periodLabel: "", methodology: "", dataSourceName: "", dataSourceUrl: "",
  retrievedAt: "", body: "", coverMediaId: "", fileMediaId: "", gated: true, isIllustrative: true, submitForReview: false,
});

function toLocalDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function mediaLabel(asset: PublicMedia) {
  return `${asset.altText?.trim() || asset.id} · ${asset.kind}`;
}

export function MarketReportsSection({ canEdit, canReview }: { canEdit: boolean; canReview: boolean }) {
  const [reports, setReports] = React.useState<MarketReport[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [assets, setAssets] = React.useState<PublicMedia[]>([]);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<MarketReport | null>(null);
  const [form, setForm] = React.useState<ReportForm>(emptyForm);
  const [formOpen, setFormOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [reviewTarget, setReviewTarget] = React.useState<{ report: MarketReport; decision: "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH" } | null>(null);
  const [reviewNote, setReviewNote] = React.useState("");
  const [reviewSaving, setReviewSaving] = React.useState(false);
  const [historyTarget, setHistoryTarget] = React.useState<MarketReport | null>(null);
  const [revisions, setRevisions] = React.useState<ReportRevision[]>([]);
  const [restoreSaving, setRestoreSaving] = React.useState(false);

  const load = React.useCallback(() => {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    api.get<{ reports: MarketReport[] }>(`/api/admin/market-reports${suffix}`)
      .then((result) => { setLoadError(false); setReports(result.reports); })
      .catch(() => { setLoadError(true); setReports([]); });
  }, [query]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (!canEdit) return;
    api.get<{ media: PublicMedia[] }>("/api/media?take=100")
      .then((result) => setAssets(result.media.filter((asset) => !asset.isPrivate && ["IMAGE", "DOCUMENT"].includes(asset.kind))))
      .catch(() => setAssets([]));
  }, [canEdit]);

  const create = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const edit = (report: MarketReport) => {
    setEditing(report);
    setForm({
      slug: report.slug, title: report.title, summary: report.summary ?? "", periodLabel: report.periodLabel ?? "",
      methodology: report.methodology ?? "", dataSourceName: report.dataSourceName ?? "", dataSourceUrl: report.dataSourceUrl ?? "",
      retrievedAt: toLocalDate(report.retrievedAt), body: report.body, coverMediaId: report.coverMediaId ?? "",
      fileMediaId: report.fileMediaId ?? "", gated: report.gated, isIllustrative: report.isIllustrative, submitForReview: false,
    });
    setFormOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const input = {
        ...form,
        summary: form.summary || null,
        periodLabel: form.periodLabel || null,
        methodology: form.methodology || null,
        dataSourceName: form.dataSourceName || null,
        dataSourceUrl: form.dataSourceUrl || null,
        retrievedAt: form.retrievedAt ? new Date(form.retrievedAt).toISOString() : null,
        coverMediaId: form.coverMediaId || null,
        fileMediaId: form.fileMediaId || null,
      };
      if (editing) {
        await api.patch("/api/admin/market-reports", { ...input, reportId: editing.id, expectedUpdatedAt: editing.updatedAt });
        toast.success(form.submitForReview ? "Saved and submitted for review" : "Saved as an unpublished draft");
      } else {
        await api.post("/api/admin/market-reports", input);
        toast.success(form.submitForReview ? "Draft created and submitted for review" : "Draft created");
      }
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Market report could not be saved");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setSaving(false); }
  };

  const openReview = (report: MarketReport, decision: "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH") => {
    setReviewNote("");
    setReviewTarget({ report, decision });
  };

  const decide = async () => {
    if (!reviewTarget) return;
    setReviewSaving(true);
    try {
      await api.post(`/api/admin/market-reports/${reviewTarget.report.id}/review`, {
        expectedUpdatedAt: reviewTarget.report.updatedAt, decision: reviewTarget.decision, note: reviewNote,
      });
      const message = reviewTarget.decision === "PUBLISH" ? "Approved report published" : reviewTarget.decision === "APPROVE" ? "Report approved; publication remains a separate action" : "Changes requested; report remains unpublished";
      toast.success(message);
      setReviewTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review action failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setReviewSaving(false); }
  };

  const archive = async (report: MarketReport, restore: boolean) => {
    try {
      await api.post(`/api/admin/market-reports/${report.id}/archive`, { expectedUpdatedAt: report.updatedAt, restore });
      toast.success(restore ? "Restored as an unpublished draft" : "Report retired; revisions remain preserved");
      load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Report state could not be changed"); }
  };

  const openHistory = async (report: MarketReport) => {
    try {
      const result = await api.get<{ revisions: ReportRevision[] }>(`/api/admin/market-reports/${report.id}/revisions`);
      setRevisions(result.revisions);
      setHistoryTarget(report);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Revision history could not be loaded"); }
  };

  const restoreRevision = async (revision: ReportRevision) => {
    if (!historyTarget) return;
    setRestoreSaving(true);
    try {
      await api.post(`/api/admin/market-reports/${historyTarget.id}/revisions`, { revisionId: revision.id, expectedUpdatedAt: historyTarget.updatedAt });
      toast.success(`Revision ${revision.version} restored as a draft`);
      setHistoryTarget(null);
      load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Revision could not be restored"); }
    finally { setRestoreSaving(false); }
  };

  if (!reports) return <LoadingState rows={4} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Market reports</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Manage the reports served by the public market pages. Source fields are editorially entered; they are not independently verified by this workflow.</p></div>
      {canEdit && <Button onClick={create} className="gap-2"><Plus className="h-4 w-4" aria-hidden />New report</Button>}
      </div>
      {loadError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Market reports could not be loaded. Check access or connection, then retry.</p>}
      <div className="max-w-md"><Label htmlFor="report-search">Search reports</Label><Input id="report-search" className="mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title or slug" /></div>
      {!loadError && reports.length === 0 ? <EmptyState title="No reports found" description="Create a draft only when you have appropriate source material. No market data is generated here." /> : reports.length === 0 ? null : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Report</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Source label</th><th className="px-4 py-3">History</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-border/70">
              {reports.map((report) => <tr key={report.id}>
                <td className="px-4 py-3"><p className="font-medium">{report.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{report.periodLabel || "No period entered"} · /market/reports/{report.slug}</p></td>
                <td className="px-4 py-3"><div className="flex flex-col items-start gap-1"><Badge variant="outline">{report.status.replaceAll("_", " ")}</Badge>{report.reviewWorkflowState !== "NONE" && <span className="text-[11px] text-muted-foreground">{report.reviewWorkflowState.replaceAll("_", " ")}</span>}</div></td>
                <td className="px-4 py-3"><Badge variant="outline">{report.isIllustrative ? "Illustrative" : "Unverified source"}</Badge></td>
                <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><History className="h-3.5 w-3.5" aria-hidden />{report.revisionCount}</span></td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                  {canEdit && report.status !== "RETIRED" && <Button size="sm" variant="outline" onClick={() => edit(report)}>Edit</Button>}
                  {canReview && report.status === "IN_REVIEW" && report.reviewWorkflowState === "PENDING_REVIEW" && <><Button size="sm" variant="outline" onClick={() => openReview(report, "APPROVE")}>Approve</Button><Button size="sm" variant="outline" onClick={() => openReview(report, "CHANGES_REQUESTED")}>Request changes</Button></>}
                  {canReview && report.status === "IN_REVIEW" && report.reviewWorkflowState === "APPROVED" && <Button size="sm" onClick={() => openReview(report, "PUBLISH")}>Publish</Button>}
                  {canEdit && report.status === "RETIRED" && <Button size="sm" variant="outline" onClick={() => archive(report, true)}>Restore</Button>}
                  {canEdit && report.status !== "RETIRED" && <Button size="sm" variant="ghost" onClick={() => archive(report, false)}>Retire</Button>}
                  <Button size="sm" variant="ghost" aria-label={`Revision history for ${report.title}`} onClick={() => openHistory(report)}><History className="h-4 w-4" aria-hidden /></Button>
                  {report.status === "PUBLISHED" && <Button asChild size="sm" variant="ghost"><a href={`/market/reports/${encodeURIComponent(report.slug)}`} target="_blank" rel="noreferrer" aria-label={`Open public report ${report.title}`}><FileText className="h-4 w-4" aria-hidden /></a></Button>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? "Edit market report" : "Create market report draft"}</DialogTitle><DialogDescription>Only enter source facts you have. The interface does not verify reports, DLD data, URLs, or methodology. Saving changes always withdraws a currently published report until review and publication happen again.</DialogDescription></DialogHeader>
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="report-title">Title</Label><Input id="report-title" required maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="report-slug">URL slug</Label><Input id="report-slug" required maxLength={180} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /><p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens.</p></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="report-summary">Summary</Label><Textarea id="report-summary" maxLength={1000} rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="report-period">Period label</Label><Input id="report-period" maxLength={100} value={form.periodLabel} onChange={(event) => setForm({ ...form, periodLabel: event.target.value })} placeholder="Editorially entered" /></div>
              <div className="space-y-1.5"><Label htmlFor="report-source">Source name</Label><Input id="report-source" maxLength={240} value={form.dataSourceName} onChange={(event) => setForm({ ...form, dataSourceName: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="report-source-url">Source URL</Label><Input id="report-source-url" type="url" value={form.dataSourceUrl} onChange={(event) => setForm({ ...form, dataSourceUrl: event.target.value })} placeholder="https://…" /></div>
              <div className="space-y-1.5"><Label htmlFor="report-retrieved">Source retrieval time</Label><Input id="report-retrieved" type="datetime-local" value={form.retrievedAt} onChange={(event) => setForm({ ...form, retrievedAt: event.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="report-methodology">Methodology / source notes</Label><Textarea id="report-methodology" rows={3} maxLength={5000} value={form.methodology} onChange={(event) => setForm({ ...form, methodology: event.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="report-body">Report body (Markdown; raw HTML is not rendered)</Label><Textarea id="report-body" rows={12} maxLength={50000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="report-cover">Public cover image</Label><Select value={form.coverMediaId || "none"} onValueChange={(value) => setForm({ ...form, coverMediaId: value === "none" ? "" : value })}><SelectTrigger id="report-cover"><SelectValue placeholder="No image" /></SelectTrigger><SelectContent><SelectItem value="none">No image</SelectItem>{assets.filter((asset) => asset.kind === "IMAGE").map((asset) => <SelectItem key={asset.id} value={asset.id}>{mediaLabel(asset)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="report-file">Public report document</Label><Select value={form.fileMediaId || "none"} onValueChange={(value) => setForm({ ...form, fileMediaId: value === "none" ? "" : value })}><SelectTrigger id="report-file"><SelectValue placeholder="No document" /></SelectTrigger><SelectContent><SelectItem value="none">No document</SelectItem>{assets.filter((asset) => asset.kind === "DOCUMENT").map((asset) => <SelectItem key={asset.id} value={asset.id}>{mediaLabel(asset)}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-3 rounded-lg border border-border/70 p-4">
              <label className="flex items-start justify-between gap-4"><span><span className="block text-sm font-medium">Illustrative material</span><span className="text-xs text-muted-foreground">Keep enabled for sample, placeholder, or simulated reports. Turning it off does not mark a source as verified.</span></span><Switch checked={form.isIllustrative} onCheckedChange={(isIllustrative) => setForm({ ...form, isIllustrative })} /></label>
              <label className="flex items-start justify-between gap-4"><span><span className="block text-sm font-medium">Lead-gated document</span><span className="text-xs text-muted-foreground">The report file is served only through the existing lead gate flow.</span></span><Switch checked={form.gated} onCheckedChange={(gated) => setForm({ ...form, gated })} /></label>
              <label className="flex items-start justify-between gap-4"><span><span className="block text-sm font-medium">Submit this revision for review</span><span className="text-xs text-muted-foreground">Submission stays unpublished until a different authorized reviewer approves and an authorized user publishes.</span></span><Switch checked={form.submitForReview} onCheckedChange={(submitForReview) => setForm({ ...form, submitForReview })} /></label>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : form.submitForReview ? "Save and submit" : "Save draft"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{reviewTarget?.decision === "APPROVE" ? "Approve revision" : reviewTarget?.decision === "PUBLISH" ? "Publish approved report" : "Request changes"}</DialogTitle><DialogDescription>{reviewTarget?.decision === "PUBLISH" ? "Publishing makes this report publicly visible. Source details are not independently verified by this action." : "Review is version-bound and recorded in the report history."}</DialogDescription></DialogHeader>
          {reviewTarget?.decision === "CHANGES_REQUESTED" && <div className="space-y-1.5"><Label htmlFor="report-review-note">Required change request</Label><Textarea id="report-review-note" maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></div>}
          <DialogFooter><Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button><Button onClick={decide} disabled={reviewSaving || (reviewTarget?.decision === "CHANGES_REQUESTED" && !reviewNote.trim())}>{reviewSaving ? "Saving…" : "Confirm"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyTarget)} onOpenChange={(open) => !open && setHistoryTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Report revision history</DialogTitle><DialogDescription>Restoring a historical revision always creates a new unpublished draft; prior revisions remain unchanged.</DialogDescription></DialogHeader>
          <div className="space-y-3">{revisions.map((revision) => <div key={revision.id} className="rounded-lg border border-border/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Revision {revision.version}</p><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden />{new Date(revision.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-muted-foreground">{revision.changeNote || "No change note"} · editor {revision.editedBy || "unknown"}</p><p className="mt-2 text-sm">{String(revision.snapshot?.title ?? "Invalid snapshot")} · {String(revision.snapshot?.status ?? "unknown status")}</p>{canEdit && historyTarget?.status !== "RETIRED" && <Button className="mt-3 gap-1.5" size="sm" variant="outline" onClick={() => restoreRevision(revision)} disabled={restoreSaving || !revision.snapshot}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Restore as draft</Button>}</div>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

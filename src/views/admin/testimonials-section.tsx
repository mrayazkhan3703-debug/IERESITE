"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/common";
import { History, Plus, RotateCcw } from "lucide-react";

interface Testimonial {
  id: string;
  clientName: string;
  clientRole: string | null;
  quote: string;
  rating: number | null;
  propertyContextId: string | null;
  status: "DRAFT" | "PUBLISHED" | "RETIRED" | string;
  verified: boolean;
  verifiedAt: string | null;
  consentCapturedAt: string | null;
  hasVerificationEvidence: boolean;
  hasConsentEvidence: boolean;
  updatedAt: string;
  revisionCount: number;
}

interface TestimonialForm { clientName: string; clientRole: string; quote: string; rating: string; propertyContextId: string }
interface Revision { id: string; version: number; snapshot: TestimonialForm; editedBy: string | null; changeNote: string | null; createdAt: string }
const emptyForm = (): TestimonialForm => ({ clientName: "", clientRole: "", quote: "", rating: "", propertyContextId: "" });

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

export function TestimonialsSection({ canEdit, canReview }: { canEdit: boolean; canReview: boolean }) {
  const [entries, setEntries] = React.useState<Testimonial[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [editing, setEditing] = React.useState<Testimonial | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<TestimonialForm>(emptyForm());
  const [saving, setSaving] = React.useState(false);
  const [reviewTarget, setReviewTarget] = React.useState<Testimonial | null>(null);
  const [verificationEvidenceRef, setVerificationEvidenceRef] = React.useState("");
  const [consentEvidenceRef, setConsentEvidenceRef] = React.useState("");
  const [consentCapturedAt, setConsentCapturedAt] = React.useState("");
  const [reviewNote, setReviewNote] = React.useState("");
  const [reviewSaving, setReviewSaving] = React.useState(false);
  const [historyTarget, setHistoryTarget] = React.useState<Testimonial | null>(null);
  const [revisions, setRevisions] = React.useState<Revision[]>([]);
  const [restoring, setRestoring] = React.useState(false);

  const load = React.useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "ALL") params.set("status", status);
    api.get<{ testimonials: Testimonial[] }>(`/api/admin/testimonials${params.size ? `?${params}` : ""}`)
      .then((result) => { setLoadError(false); setEntries(result.testimonials); })
      .catch(() => { setLoadError(true); setEntries([]); });
  }, [query, status]);
  React.useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(emptyForm()); };
  const openEdit = (entry: Testimonial) => {
    setEditing(entry);
    setCreating(false);
    setForm({ clientName: entry.clientName, clientRole: entry.clientRole ?? "", quote: entry.quote, rating: entry.rating?.toString() ?? "", propertyContextId: entry.propertyContextId ?? "" });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const input = {
        clientName: form.clientName,
        clientRole: form.clientRole || null,
        quote: form.quote,
        rating: form.rating ? Number(form.rating) : null,
        propertyContextId: form.propertyContextId || null,
      };
      if (editing) await api.patch("/api/admin/testimonials", { ...input, testimonialId: editing.id, expectedUpdatedAt: editing.updatedAt });
      else await api.post("/api/admin/testimonials", input);
      toast.success(editing ? "Saved as a draft; prior consent and verification were cleared" : "Testimonial draft created");
      setEditing(null);
      setCreating(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Testimonial could not be saved");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setSaving(false); }
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reviewTarget) return;
    setReviewSaving(true);
    try {
      await api.post(`/api/admin/testimonials/${encodeURIComponent(reviewTarget.id)}/publish`, {
        expectedUpdatedAt: reviewTarget.updatedAt,
        verificationEvidenceRef,
        consentEvidenceRef,
        consentCapturedAt: consentCapturedAt ? new Date(consentCapturedAt).toISOString() : "",
        reviewNote,
      });
      toast.success("Testimonial verified and published");
      setReviewTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Testimonial could not be published");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setReviewSaving(false); }
  };

  const changeState = async (entry: Testimonial, restore: boolean) => {
    try {
      await api.post(`/api/admin/testimonials/${encodeURIComponent(entry.id)}/archive`, { expectedUpdatedAt: entry.updatedAt, restore });
      toast.success(restore ? "Restored as an unpublished draft" : "Testimonial retired");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Testimonial state could not be changed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    }
  };

  const openHistory = async (entry: Testimonial) => {
    setHistoryTarget(entry);
    try {
      const result = await api.get<{ revisions: Revision[] }>(`/api/admin/testimonials/${encodeURIComponent(entry.id)}/revisions`);
      setRevisions(result.revisions);
    } catch {
      setRevisions([]);
      toast.error("Revision history could not be loaded");
    }
  };

  const restoreRevision = async (revision: Revision) => {
    if (!historyTarget) return;
    setRestoring(true);
    try {
      await api.post(`/api/admin/testimonials/${encodeURIComponent(historyTarget.id)}/revisions`, { revisionId: revision.id, expectedUpdatedAt: historyTarget.updatedAt });
      toast.success("Revision restored as a draft; new consent review is required");
      setHistoryTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revision could not be restored");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally { setRestoring(false); }
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl font-semibold">Testimonials</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Only publish a real client-supplied quote with current consent and verification evidence. New, edited, restored, or retired entries are not public until independently reviewed.</p></div>
      {canEdit && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add testimonial</Button>}
    </header>
    <div className="flex flex-wrap gap-3">
      <Input className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client name or quote" aria-label="Search testimonials" />
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem><SelectItem value="DRAFT">Draft</SelectItem><SelectItem value="PUBLISHED">Published</SelectItem><SelectItem value="RETIRED">Retired</SelectItem></SelectContent></Select>
    </div>
    {entries === null ? <LoadingState rows={4} /> : loadError ? <EmptyState title="Testimonials unavailable" description="The protected moderation list could not be loaded. Try again." /> : entries.length === 0 ? <EmptyState title="No testimonials found" description="Add only quotes actually supplied by a client. A new entry stays private until verified." /> : <div className="overflow-x-safe rounded-xl border border-border/70">
      <table className="w-full min-w-[900px] text-sm">
        <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Client / quote</th><th className="p-3">Status</th><th className="p-3">Verification</th><th className="p-3">Consent</th><th className="p-3">Updated</th><th className="p-3">Actions</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-border/50 align-top">
          <td className="max-w-lg p-3"><p className="font-medium">{entry.clientName}{entry.clientRole ? <span className="font-normal text-muted-foreground"> · {entry.clientRole}</span> : null}</p><p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{entry.quote}</p></td>
          <td className="p-3"><Badge variant="outline">{entry.status}</Badge></td>
          <td className="p-3"><span>{entry.verified ? "Verified" : "Not verified"}</span><span className="mt-1 block text-xs text-muted-foreground">{entry.hasVerificationEvidence ? "Reference recorded" : "No evidence"}</span></td>
          <td className="p-3"><span>{entry.consentCapturedAt ? formatDate(entry.consentCapturedAt) : "Not recorded"}</span><span className="mt-1 block text-xs text-muted-foreground">{entry.hasConsentEvidence ? "Reference recorded" : "No evidence"}</span></td>
          <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatDate(entry.updatedAt)}</td>
          <td className="p-3"><div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void openHistory(entry)}><History className="mr-1.5 h-3.5 w-3.5" />History</Button>
            {canEdit && entry.status !== "RETIRED" && <Button size="sm" variant="outline" onClick={() => openEdit(entry)}>Edit</Button>}
            {canReview && entry.status === "DRAFT" && <Button size="sm" onClick={() => { setReviewTarget(entry); setVerificationEvidenceRef(""); setConsentEvidenceRef(""); setConsentCapturedAt(""); setReviewNote(""); }}>Review & publish</Button>}
            {canEdit && entry.status === "RETIRED" && <Button size="sm" variant="outline" onClick={() => void changeState(entry, true)}>Restore as draft</Button>}
            {canEdit && entry.status !== "RETIRED" && <Button size="sm" variant="ghost" onClick={() => void changeState(entry, false)}>Retire</Button>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {canEdit && <Dialog open={creating || editing !== null} onOpenChange={(open) => { if (!open && !saving) { setCreating(false); setEditing(null); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{creating ? "Create testimonial draft" : "Edit testimonial draft"}</DialogTitle><DialogDescription>Enter only a quote genuinely supplied by the client. Saving any change unpublishes the entry and clears its previous consent and verification attestations.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">Do not invent or AI-generate testimonials, names, ratings, property context, consent, or verification details. Keep actual evidence in its approved private system; this form accepts only opaque internal reference IDs.</div>
          <label className="block space-y-1.5 text-sm font-medium">Client name<Input required maxLength={160} value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Client role (optional)<Input maxLength={160} value={form.clientRole} onChange={(event) => setForm({ ...form, clientRole: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Client-supplied quote<Textarea required maxLength={5000} rows={6} value={form.quote} onChange={(event) => setForm({ ...form, quote: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">Rating (only if explicitly supplied)<Input type="number" min={1} max={5} step={1} value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Property context ID (optional)<Input maxLength={180} value={form.propertyContextId} onChange={(event) => setForm({ ...form, propertyContextId: event.target.value })} /></label>
          </div>
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create private draft" : "Save as draft"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}

    {canReview && <Dialog open={reviewTarget !== null} onOpenChange={(open) => { if (!open && !reviewSaving) setReviewTarget(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Verify and publish testimonial</DialogTitle><DialogDescription>Confirm this is the real supplied quote, its current publication consent, and evidence in approved internal systems. A reviewer cannot publish their own latest edit.</DialogDescription></DialogHeader>
        {reviewTarget && <div className="space-y-3">
          <blockquote className="rounded-lg border bg-muted/30 p-3 text-sm">“{reviewTarget.quote}”<footer className="mt-2 text-xs text-muted-foreground">{reviewTarget.clientName}</footer></blockquote>
          <form className="space-y-4" onSubmit={publish}>
            <label className="block space-y-1.5 text-sm font-medium">Verification evidence reference<Input required maxLength={180} pattern="[A-Za-z0-9][A-Za-z0-9:._/-]*" value={verificationEvidenceRef} onChange={(event) => setVerificationEvidenceRef(event.target.value)} placeholder="e.g. internal-record-id" /></label>
            <label className="block space-y-1.5 text-sm font-medium">Consent evidence reference<Input required maxLength={180} pattern="[A-Za-z0-9][A-Za-z0-9:._/-]*" value={consentEvidenceRef} onChange={(event) => setConsentEvidenceRef(event.target.value)} placeholder="e.g. consent-record-id" /></label>
            <label className="block space-y-1.5 text-sm font-medium">Consent captured at<Input required type="datetime-local" value={consentCapturedAt} onChange={(event) => setConsentCapturedAt(event.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium">Review note<Textarea required minLength={3} maxLength={1000} rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Record the basis for this decision" /></label>
            <DialogFooter><Button type="button" variant="outline" disabled={reviewSaving} onClick={() => setReviewTarget(null)}>Cancel</Button><Button type="submit" disabled={reviewSaving}>{reviewSaving ? "Verifying…" : "Verify and publish"}</Button></DialogFooter>
          </form>
        </div>}
      </DialogContent>
    </Dialog>}

    <Dialog open={historyTarget !== null} onOpenChange={(open) => { if (!open && !restoring) setHistoryTarget(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Testimonial history</DialogTitle><DialogDescription>Historical quotes can only be restored as an unpublished draft. Verification and consent are never restored with content.</DialogDescription></DialogHeader>
        {revisions.length ? <div className="space-y-3">{revisions.map((revision) => <article key={revision.id} className="rounded-lg border border-border/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><Badge variant="outline">Revision {revision.version}</Badge><p className="mt-1 text-xs text-muted-foreground">{formatDate(revision.createdAt)} · {revision.changeNote ?? "No note"}</p></div>{canEdit && <Button size="sm" variant="outline" disabled={restoring} onClick={() => void restoreRevision(revision)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Restore as draft</Button>}</div>
          <p className="mt-3 text-sm font-medium">{revision.snapshot?.clientName}</p><p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{revision.snapshot?.quote}</p>
        </article>)}</div> : <EmptyState title="No revisions found" description="Revision history appears after the first Admin-managed change." />}
        <DialogFooter><Button variant="outline" onClick={() => setHistoryTarget(null)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

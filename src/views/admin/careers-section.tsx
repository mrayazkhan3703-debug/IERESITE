"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingState } from "@/components/common";
import { History, Plus } from "lucide-react";
import { confirmDiscardChanges, useUnsavedChanges } from "@/features/admin/shared/admin-primitives";

type Opening = {
  id: string; locale: "en" | "ar"; slug: string; title: string; department: string; location: string; employmentType: string;
  workplaceType: string; summary: string; description: string; status: string; reviewWorkflowState: string;
  closesAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string; revisionCount: number; latestEditorId: string | null;
  responsibilities: string; requirements: string; benefits: string | null; salaryDisclosure: string | null;
  applicationMethod: "CONTACT" | "EMAIL" | "URL"; applicationTarget: string | null; opensAt: string | null; seoTitle: string | null; seoDescription: string | null;
};
type Form = Omit<Opening, "id" | "status" | "reviewWorkflowState" | "publishedAt" | "createdAt" | "updatedAt" | "revisionCount" | "latestEditorId" | "closesAt" | "opensAt"> & { closesAt: string; opensAt: string };
const blank = (): Form => ({ locale: "en", slug: "", title: "", department: "", location: "", employmentType: "Full-time", workplaceType: "On-site", summary: "", description: "", responsibilities: "", requirements: "", benefits: null, salaryDisclosure: null, applicationMethod: "CONTACT", applicationTarget: null, opensAt: "", closesAt: "", seoTitle: null, seoDescription: null });
const asLocal = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

export function CareersSection({ actorId, canEdit, canReview }: { actorId: string; canEdit: boolean; canReview: boolean }) {
  const [openings, setOpenings] = React.useState<Opening[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [editing, setEditing] = React.useState<Opening | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<Form>(blank());
  const [busy, setBusy] = React.useState(false);
  const [reviewNote, setReviewNote] = React.useState("");
  const [history, setHistory] = React.useState<{ version: number; editedBy: string | null; changeNote: string | null; createdAt: string; snapshot: Record<string, unknown> }[] | null>(null);
  const formSnapshot = React.useRef(JSON.stringify(blank()));

  const load = React.useCallback(() => api.get<{ openings: Opening[] }>("/api/admin/careers").then((result) => { setOpenings(result.openings); setLoadFailed(false); }).catch(() => { setOpenings([]); setLoadFailed(true); }), []);
  React.useEffect(() => { load(); }, [load]);
  const startNew = () => { if (!confirmDiscardChanges(dirty)) return; const next = blank(); formSnapshot.current = JSON.stringify(next); setEditing(null); setCreating(true); setForm(next); };
  const startEdit = (entry: Opening) => {
    if (!confirmDiscardChanges(dirty)) return;
    setCreating(false); setEditing(entry);
    const next: Form = { locale: entry.locale, slug: entry.slug, title: entry.title, department: entry.department, location: entry.location, employmentType: entry.employmentType, workplaceType: entry.workplaceType, summary: entry.summary, description: entry.description, responsibilities: entry.responsibilities, requirements: entry.requirements, benefits: entry.benefits, salaryDisclosure: entry.salaryDisclosure, applicationMethod: entry.applicationMethod, applicationTarget: entry.applicationTarget, opensAt: asLocal(entry.opensAt), closesAt: asLocal(entry.closesAt), seoTitle: entry.seoTitle, seoDescription: entry.seoDescription }; formSnapshot.current = JSON.stringify(next); setForm(next);
  };
  const save = async (event: React.FormEvent, submitForReview: boolean) => {
    event.preventDefault(); setBusy(true);
    const payload = { ...form, opensAt: form.opensAt ? new Date(form.opensAt).toISOString() : null, closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null };
    try {
      if (editing) await api.patch("/api/admin/careers", { ...payload, careerOpeningId: editing.id, expectedUpdatedAt: editing.updatedAt, submitForReview });
      else await api.post("/api/admin/careers", payload);
      toast.success(editing ? (submitForReview ? "Role submitted for review" : "Draft saved") : "Career draft created");
      setEditing(null); setCreating(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Career opening could not be saved"); if (error instanceof Error && error.message.toLowerCase().includes("changed")) await load(); }
    finally { setBusy(false); }
  };
  const decision = async (entry: Opening, choice: "APPROVE" | "CHANGES_REQUESTED" | "PUBLISH") => {
    setBusy(true);
    try {
      await api.post("/api/admin/careers/review", { careerOpeningId: entry.id, expectedUpdatedAt: entry.updatedAt, decision: choice, note: reviewNote });
      toast.success(choice === "PUBLISH" ? "Opening published" : choice === "APPROVE" ? "Opening approved" : "Changes requested");
      setReviewNote(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Review action failed"); if (error instanceof Error && error.message.toLowerCase().includes("changed")) await load(); }
    finally { setBusy(false); }
  };
  const close = async (entry: Opening, retire = false) => {
    setBusy(true);
    try { await api.post("/api/admin/careers/close", { careerOpeningId: entry.id, expectedUpdatedAt: entry.updatedAt, retire }); toast.success(retire ? "Opening archived" : "Opening closed"); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Opening could not be closed"); }
    finally { setBusy(false); }
  };
  const restore = async (entry: Opening) => {
    setBusy(true);
    try { await api.post("/api/admin/careers/restore", { careerOpeningId: entry.id, expectedUpdatedAt: entry.updatedAt }); toast.success("Opening restored as a private draft"); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Opening could not be restored"); }
    finally { setBusy(false); }
  };
  const showHistory = async (entry: Opening) => {
    try { const result = await api.get<{ revisions: NonNullable<typeof history> }>(`/api/admin/careers/${encodeURIComponent(entry.id)}/revisions`); setHistory(result.revisions); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Revision history unavailable"); }
  };

  const formOpen = creating || editing !== null;
  const dirty = formOpen && JSON.stringify(form) !== formSnapshot.current;
  useUnsavedChanges(dirty);
  const extraFields = <>
    {(["responsibilities", "requirements", "benefits"] as const).map((field) => <label key={field} className="block space-y-1 text-sm"><span className="capitalize">{field}</span>{field === "requirements" && <span className="ml-1 text-xs text-muted-foreground">(required for approval)</span>}<Textarea rows={4} maxLength={12000} value={form[field] ?? ""} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></label>)}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Salary disclosure (optional; reviewed before publication)<Input maxLength={180} value={form.salaryDisclosure ?? ""} onChange={(event) => setForm({ ...form, salaryDisclosure: event.target.value })} /></label>
      <label className="space-y-1 text-sm">Opens at (optional)<Input type="datetime-local" value={form.opensAt} onChange={(event) => setForm({ ...form, opensAt: event.target.value })} /></label>
      <label className="space-y-1 text-sm">Application method<select aria-label="Application method" className="h-10 w-full rounded-md border bg-background px-3" value={form.applicationMethod} onChange={(event) => setForm({ ...form, applicationMethod: event.target.value as Form["applicationMethod"], applicationTarget: null })}><option value="CONTACT">Contact page</option><option value="EMAIL">Approved email</option><option value="URL">Approved external website</option></select></label>
      {form.applicationMethod !== "CONTACT" && <label className="space-y-1 text-sm">Application destination<Input required type={form.applicationMethod === "EMAIL" ? "email" : "url"} maxLength={2000} value={form.applicationTarget ?? ""} onChange={(event) => setForm({ ...form, applicationTarget: event.target.value })} /></label>}
      <label className="space-y-1 text-sm">SEO title (optional)<Input maxLength={180} value={form.seoTitle ?? ""} onChange={(event) => setForm({ ...form, seoTitle: event.target.value })} /></label>
      <label className="space-y-1 text-sm">SEO description (optional)<Textarea rows={2} maxLength={300} value={form.seoDescription ?? ""} onChange={(event) => setForm({ ...form, seoDescription: event.target.value })} /></label>
    </div>
    <p className="text-xs text-muted-foreground">Applications use the approved destination. This site does not collect or store CVs.</p>
  </>;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold">Careers</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Manage real openings as versioned records. Drafts stay private. An owner or admin who did not edit the draft must approve it before publication.</p></div>{canEdit && <Button onClick={startNew}><Plus className="mr-2 h-4 w-4" />Add opening</Button>}</header>
    {openings === null ? <LoadingState rows={4} /> : loadFailed ? <EmptyState title="Career openings unavailable" description="The protected list could not be loaded. Refresh to try again." /> : openings.length === 0 ? <EmptyState title="No openings yet" description="Create the first vacancy when the role is approved internally." /> : <div className="space-y-3">{openings.map((entry) => <article key={entry.id} className="rounded-xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-semibold">{entry.title}</h2><Badge variant="outline">{entry.status}{entry.reviewWorkflowState !== "NONE" ? ` · ${entry.reviewWorkflowState}` : ""}</Badge><Badge variant="outline">{entry.locale.toUpperCase()}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{entry.department} · {entry.location} · {entry.employmentType} · {entry.workplaceType}</p><p className="mt-2 text-sm">{entry.summary}</p><p className="mt-1 text-xs text-muted-foreground">{entry.revisionCount} revisions · updated {new Date(entry.updatedAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void showHistory(entry)}><History className="mr-1.5 h-3.5 w-3.5" />History</Button>{canEdit && !["CLOSED", "RETIRED"].includes(entry.status) && <Button size="sm" variant="outline" onClick={() => startEdit(entry)}>Edit</Button>}</div></div>
      <details className="mt-4 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Full role preview</summary><div className="mt-3 space-y-4 text-sm">{(["description", "responsibilities", "requirements", "benefits"] as const).map((field) => entry[field] ? <section key={field}><h3 className="mb-1 font-medium capitalize">{field}</h3><p className="whitespace-pre-wrap text-muted-foreground">{entry[field]}</p></section> : null)}{entry.salaryDisclosure && <p>Salary disclosure: {entry.salaryDisclosure}</p>}<p>Application method: {entry.applicationMethod}{entry.applicationTarget ? ` · ${entry.applicationTarget}` : " · Contact page"}</p></div></details>
      {entry.status === "IN_REVIEW" && entry.reviewWorkflowState === "PENDING_REVIEW" && <div className="mt-4 rounded-lg bg-sand/50 p-3"><label className="block text-xs font-medium">Review note (required when requesting changes)<Textarea rows={2} maxLength={1000} className="mt-1.5" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className="mt-2 flex flex-wrap gap-2">{canReview && <><Button size="sm" disabled={busy || entry.latestEditorId === actorId} onClick={() => void decision(entry, "APPROVE")}>Approve</Button><Button size="sm" variant="outline" disabled={busy || entry.latestEditorId === actorId || !reviewNote.trim()} onClick={() => void decision(entry, "CHANGES_REQUESTED")}>Request changes</Button></>}{entry.latestEditorId === actorId && <span className="self-center text-xs text-muted-foreground">A different reviewer must review this revision.</span>}</div></div>}
      {entry.status === "IN_REVIEW" && entry.reviewWorkflowState === "APPROVED" && canReview && <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void decision(entry, "PUBLISH")}>Publish approved opening</Button></div>}
      {canEdit && entry.status === "PUBLISHED" && <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void close(entry)}>Close opening</Button>}
      {canEdit && entry.status !== "RETIRED" && <Button className="ml-2 mt-3" size="sm" variant="ghost" disabled={busy} onClick={() => void close(entry, true)}>Archive opening</Button>}
      {canEdit && ["CLOSED", "RETIRED"].includes(entry.status) && <Button className="ml-2 mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void restore(entry)}>Restore as draft</Button>}
    </article>)}</div>}

    {formOpen && canEdit && <section className="rounded-xl border border-border/70 bg-card p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-display text-lg font-semibold">{creating ? "New career opening" : "Edit career opening"}</h2><p className="text-xs text-muted-foreground">Saving a published role returns it to private review until it is reapproved and republished.</p></div><Button variant="ghost" size="sm" onClick={() => { if (!confirmDiscardChanges(dirty)) return; setCreating(false); setEditing(null); }}>Close</Button></div>
      <form className="space-y-4" onSubmit={(event) => void save(event, false)}><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Title<Input required maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="space-y-1 text-sm">URL slug<Input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label><label className="space-y-1 text-sm">Department<Input required maxLength={100} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label><label className="space-y-1 text-sm">Location<Input required maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label className="space-y-1 text-sm">Employment type<Input required maxLength={80} value={form.employmentType} onChange={(event) => setForm({ ...form, employmentType: event.target.value })} /></label><label className="space-y-1 text-sm">Workplace type<Input required maxLength={80} value={form.workplaceType} onChange={(event) => setForm({ ...form, workplaceType: event.target.value })} /></label><label className="space-y-1 text-sm">Language<select aria-label="Language" className="h-10 w-full rounded-md border bg-background px-3" value={form.locale} onChange={(event) => setForm({ ...form, locale: event.target.value as "en" | "ar" })}><option value="en">English</option><option value="ar">Arabic</option></select></label><label className="space-y-1 text-sm">Closes at (optional)<Input type="datetime-local" value={form.closesAt} onChange={(event) => setForm({ ...form, closesAt: event.target.value })} /></label></div><label className="block space-y-1 text-sm">Summary<Textarea required maxLength={1000} rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><label className="block space-y-1 text-sm">Description<Textarea required maxLength={12000} rows={7} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{extraFields}<div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>{editing && <Button type="button" disabled={busy} onClick={(event) => { const formElement = event.currentTarget.closest("form"); if (formElement?.reportValidity()) void save({ preventDefault: () => undefined } as React.FormEvent, true); }}>Submit for review</Button>}</div></form>
    </section>}

    {history && <section className="rounded-xl border border-border/70 bg-card p-5"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Revision history</h2><Button variant="ghost" size="sm" onClick={() => setHistory(null)}>Close</Button></div>{history.length ? <ol className="mt-3 space-y-3">{history.map((revision) => <li key={revision.version} className="rounded-lg border p-3"><div className="flex items-center gap-2"><Badge variant="outline">Revision {revision.version}</Badge><span className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()} · {revision.changeNote ?? "No note"}</span></div><p className="mt-2 text-sm font-medium">{String(revision.snapshot.title ?? "")}</p><p className="text-xs text-muted-foreground">{String(revision.snapshot.status ?? "")} · {String(revision.snapshot.locale ?? "")} · {String(revision.snapshot.slug ?? "")}</p></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">No revisions recorded.</p>}</section>}
  </div>;
}

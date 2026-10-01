"use client";

import * as React from "react";
import { AdvisorOperations } from "./shared/advisor-operations";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, ErrorState, EmptyState, StatusBadge } from "@/components/common";
import { toast } from "sonner";
import { BookOpenCheck, Check, Clock3, FilePlus2, Plus, RefreshCcw, Save, ShieldAlert, X } from "lucide-react";

type RagDocumentRow = {
  id: string; sourceId: string; title: string; slug: string; locale: string;
  status: string; version: number; createdById: string | null; updatedById: string | null;
  approvedById: string | null; approvedAt: string | null; updatedAt: string;
  chunkCount: number; revisionCount: number;
};

type RagSourceRow = {
  id: string; title: string; sourceType: string; canonicalUrl: string | null; publisher: string | null;
  version: string | null; trustTier: string; verifiedAt: string | null; freshnessReviewDueAt: string | null;
  isActive: boolean; isApproved: boolean; createdById: string | null; updatedById: string | null;
  approvedById: string | null; approvedAt: string | null; updatedAt: string; documents: RagDocumentRow[]; documentsTruncated: boolean; documentCount: number;
};

type SourceDraft = {
  title: string; sourceType: string; canonicalUrl: string; publisher: string; version: string;
  trustTier: string; verifiedAt: string; freshnessReviewDueAt: string; isActive: boolean;
};

type DocumentDraft = { sourceId: string; title: string; slug: string; locale: "en" | "ar"; content: string; changeNote: string };

const EMPTY_SOURCE: SourceDraft = {
  title: "", sourceType: "OFFICIAL", canonicalUrl: "", publisher: "", version: "",
  trustTier: "OFFICIAL", verifiedAt: "", freshnessReviewDueAt: "", isActive: true,
};
const EMPTY_DOCUMENT: DocumentDraft = { sourceId: "", title: "", slug: "", locale: "en", content: "", changeNote: "" };
const asIsoDate = (value: string) => value ? new Date(`${value}T00:00:00.000Z`).toISOString() : "";
const asDateInput = (value: string | null) => value ? value.slice(0, 10) : "";

export function KnowledgeBaseSection({ canEdit, canReview }: { canEdit: boolean; canReview: boolean }) {
  const [sources, setSources] = React.useState<RagSourceRow[] | null>(null);
  const [error, setError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [editingSourceId, setEditingSourceId] = React.useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = React.useState<SourceDraft>(EMPTY_SOURCE);
  const [editingDocumentId, setEditingDocumentId] = React.useState<string | null>(null);
  const [documentDraft, setDocumentDraft] = React.useState<DocumentDraft>(EMPTY_DOCUMENT);
  const [editingDocumentVersion, setEditingDocumentVersion] = React.useState<string | null>(null);
  const [sourcesTruncated, setSourcesTruncated] = React.useState(false);
  const [reviewNote, setReviewNote] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const result = await api.get<{ sources: RagSourceRow[]; sourcesTruncated: boolean }>("/api/admin/rag");
      setSources(result.sources);
      setSourcesTruncated(result.sourcesTruncated);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (err) { toast.error(err instanceof Error ? err.message : "Knowledge base update failed."); }
    finally { setBusy(false); }
  };

  const sourcePayload = () => ({
    ...sourceDraft,
    verifiedAt: asIsoDate(sourceDraft.verifiedAt),
    freshnessReviewDueAt: asIsoDate(sourceDraft.freshnessReviewDueAt),
    canonicalUrl: sourceDraft.canonicalUrl || null,
    publisher: sourceDraft.publisher || null,
    version: sourceDraft.version || null,
  });

  const saveSource = (event: React.FormEvent) => {
    event.preventDefault();
    void withBusy(async () => {
      if (editingSourceId) {
        const current = sources?.find((source) => source.id === editingSourceId);
        if (!current) throw new Error("Source is no longer available. Refresh and retry.");
        await api.patch(`/api/admin/rag/${encodeURIComponent(current.id)}`, { ...sourcePayload(), expectedUpdatedAt: current.updatedAt });
        toast.success("Source saved as pending review; its prior approval was cleared.");
      } else {
        await api.post("/api/admin/rag", sourcePayload());
        toast.success("Source draft created. A different owner/admin must approve it.");
      }
      setEditingSourceId(null);
      setSourceDraft(EMPTY_SOURCE);
      await load();
    });
  };

  const startSourceEdit = (source: RagSourceRow) => {
    setEditingSourceId(source.id);
    setSourceDraft({
      title: source.title, sourceType: source.sourceType, canonicalUrl: source.canonicalUrl ?? "",
      publisher: source.publisher ?? "", version: source.version ?? "", trustTier: source.trustTier,
      verifiedAt: asDateInput(source.verifiedAt), freshnessReviewDueAt: asDateInput(source.freshnessReviewDueAt), isActive: source.isActive,
    });
  };

  const reviewSource = (source: RagSourceRow, decision: "APPROVE" | "REVOKE") => void withBusy(async () => {
    await api.post(`/api/admin/rag/${encodeURIComponent(source.id)}/review`, {
      expectedUpdatedAt: source.updatedAt, decision, note: reviewNote,
    });
    setReviewNote("");
    toast.success(decision === "APPROVE" ? "Source approved with a freshness review deadline." : "Source approval revoked.");
    await load();
  });

  const documentPayload = () => ({
    ...documentDraft,
    content: documentDraft.content,
    changeNote: documentDraft.changeNote || undefined,
  });

  const saveDocument = (event: React.FormEvent) => {
    event.preventDefault();
    void withBusy(async () => {
      if (editingDocumentId) {
        const current = sources?.flatMap((source) => source.documents).find((document) => document.id === editingDocumentId);
        if (!current || !editingDocumentVersion) throw new Error("Document is no longer available. Refresh and retry.");
        await api.patch(`/api/admin/rag/documents/${encodeURIComponent(current.id)}`, {
          ...documentPayload(), expectedUpdatedAt: editingDocumentVersion,
        });
        toast.success("Document saved as a draft; prior approval and stored chunks (see current index diagnostics) were cleared.");
      } else {
        await api.post("/api/admin/rag/documents", documentPayload());
        toast.success("Document draft created. It must be reviewed before retrieval.");
      }
      setEditingDocumentId(null);
      setDocumentDraft(EMPTY_DOCUMENT);
      await load();
    });
  };

  const startDocumentEdit = (document: RagDocumentRow) => void withBusy(async () => {
    const { document: current } = await api.get<{ document: RagDocumentRow & { content: string } }>(`/api/admin/rag/documents/${encodeURIComponent(document.id)}`);
    setEditingDocumentId(current.id);
    setEditingDocumentVersion(current.updatedAt);
    setDocumentDraft({
      sourceId: current.sourceId, title: current.title, slug: current.slug,
      locale: current.locale === "ar" ? "ar" : "en", content: current.content, changeNote: "",
    });
  });

  const reviewDocument = (document: RagDocumentRow, decision: "APPROVE" | "CHANGES_REQUESTED" | "RETIRE" | "RESTORE") => void withBusy(async () => {
    await api.post(`/api/admin/rag/documents/${encodeURIComponent(document.id)}/review`, {
      expectedUpdatedAt: document.updatedAt, decision, note: reviewNote,
    });
    setReviewNote("");
    toast.success(decision === "APPROVE" ? "Document approved and queued for local indexing." : `Document ${decision.toLowerCase().replaceAll("_", " ")}.`);
    await load();
  });

  if (!sources) return error ? <ErrorState message="The AI knowledge base could not be loaded." onRetry={() => void load()} /> : <LoadingState />;

  const isFreshSource = (source: RagSourceRow) => Boolean(
    source.verifiedAt && source.freshnessReviewDueAt
    && new Date(source.verifiedAt).getTime() <= Date.now()
    && new Date(source.freshnessReviewDueAt).getTime() > Date.now(),
  );
  const approvedSources = sources.filter((source) => source.isActive && source.isApproved && isFreshSource(source) && source.trustTier !== "UNVERIFIED");
  const documentList = sources.flatMap((source) => source.documents.map((document) => ({ ...document, sourceTitle: source.title, sourceApproved: source.isActive && source.isApproved })));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Knowledge Base</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Manage source provenance and reviewed English/Arabic knowledge documents. Approving content means you independently checked the cited source and set its next review date; the system does not verify external facts.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}><RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>
      </header>

      <AdvisorOperations canManage={canReview} />
      <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <p>Nothing is available to the advisor until both the source and document are approved. Do not add customer contact data. No live external source verification is performed here.</p>
      </div>

      {canEdit && <section className="rounded-xl border border-border/70 p-4 sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Plus className="h-4 w-4" />{editingSourceId ? "Edit source" : "Register source draft"}</h2>
        <form onSubmit={saveSource} className="grid gap-3 md:grid-cols-2">
          <Input aria-label="Source title" placeholder="Source title" value={sourceDraft.title} onChange={(e) => setSourceDraft({ ...sourceDraft, title: e.target.value })} required maxLength={240} />
          <label className="text-sm">Source type<Select value={sourceDraft.sourceType} onValueChange={(value) => setSourceDraft({ ...sourceDraft, sourceType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OFFICIAL", "INTERNAL_DOC", "GUIDE", "REPORT", "NEWS"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
          <Input aria-label="Canonical HTTPS URL" placeholder="Canonical HTTPS URL (required for official trust tier)" type="url" value={sourceDraft.canonicalUrl} onChange={(e) => setSourceDraft({ ...sourceDraft, canonicalUrl: e.target.value })} />
          <Input aria-label="Publisher" placeholder="Publisher / issuing organization" value={sourceDraft.publisher} onChange={(e) => setSourceDraft({ ...sourceDraft, publisher: e.target.value })} maxLength={240} />
          <Input aria-label="Source version" placeholder="Source version / edition (optional)" value={sourceDraft.version} onChange={(e) => setSourceDraft({ ...sourceDraft, version: e.target.value })} maxLength={120} />
          <label className="text-sm">Trust tier<Select value={sourceDraft.trustTier} onValueChange={(value) => setSourceDraft({ ...sourceDraft, trustTier: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OFFICIAL", "INTERNAL", "SECONDARY", "UNVERIFIED"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
          <label className="text-sm">Verified from source<Input aria-label="Verified date" type="date" value={sourceDraft.verifiedAt} onChange={(e) => setSourceDraft({ ...sourceDraft, verifiedAt: e.target.value })} required /></label>
          <label className="text-sm">Freshness review due<Input aria-label="Freshness review due date" type="date" value={sourceDraft.freshnessReviewDueAt} onChange={(e) => setSourceDraft({ ...sourceDraft, freshnessReviewDueAt: e.target.value })} required /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sourceDraft.isActive} onChange={(e) => setSourceDraft({ ...sourceDraft, isActive: e.target.checked })} />Active source (still requires review approval)</label>
          <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy}><Save className="mr-2 h-4 w-4" />{editingSourceId ? "Save source" : "Create source draft"}</Button>{editingSourceId && <Button type="button" variant="outline" onClick={() => { setEditingSourceId(null); setSourceDraft(EMPTY_SOURCE); }}>Cancel</Button>}</div>
        </form>
      </section>}

      {canReview && <div className="max-w-2xl"><Input aria-label="Review note" placeholder="Review note (required for your audit explanation)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={500} /></div>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sources · {sources.length}</h2>
        {sourcesTruncated && <p className="text-sm text-muted-foreground">Showing the 100 most recently updated sources. The paginated index diagnostics includes all knowledge documents.</p>}
        {sources.length === 0 ? <EmptyState title="No knowledge sources" description="Register a real source only after you have the source material and provenance to review." /> : sources.map((source) => (
          <article key={source.id} className="rounded-xl border border-border/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{source.title}</h3><StatusBadge status={source.isApproved && isFreshSource(source) ? "APPROVED" : source.isApproved ? "REVIEW_DUE" : "DRAFT"} /><StatusBadge status={source.isActive ? "ACTIVE" : "INACTIVE"} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{source.trustTier} · {source.sourceType} · {source.canonicalUrl ?? "Internal source"}</p>
                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground"><span>Verified: {source.verifiedAt ? new Date(source.verifiedAt).toLocaleDateString() : "not set"}</span><span>Review due: {source.freshnessReviewDueAt ? new Date(source.freshnessReviewDueAt).toLocaleDateString() : "not set"}</span><span>Reviewer: {source.approvedById ?? "none"}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">{canEdit && <Button size="sm" variant="outline" onClick={() => startSourceEdit(source)} disabled={busy}>Edit</Button>}{canReview && source.isApproved && <Button size="sm" variant="outline" onClick={() => reviewSource(source, "REVOKE")} disabled={busy || !reviewNote.trim()}><X className="mr-1 h-3.5 w-3.5" />Revoke</Button>}{canReview && !source.isApproved && <Button size="sm" onClick={() => reviewSource(source, "APPROVE")} disabled={busy || !reviewNote.trim() || !source.isActive || !isFreshSource(source) || source.trustTier === "UNVERIFIED"}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>}</div>
            </div>
            {source.documentsTruncated && <p className="mt-3 text-sm text-muted-foreground">Showing {source.documents.length} of {source.documentCount} documents. Use index diagnostics to inspect later documents.</p>}
            {source.documents.length > 0 && <div className="mt-4 space-y-2 border-t border-border/70 pt-3">{source.documents.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/30 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{document.title} <span className="text-xs text-muted-foreground">· {document.locale.toUpperCase()} · v{document.version}</span></p><p className="text-xs text-muted-foreground">{document.status} · {document.chunkCount} stored chunks (see current index diagnostics) · {document.revisionCount} revisions · {source.title}</p></div>
                <div className="flex flex-wrap gap-2">{canEdit && document.status !== "RETIRED" && <Button size="sm" variant="outline" onClick={() => startDocumentEdit(document)} disabled={busy}>Edit</Button>}{canReview && document.status === "DRAFT" && source.isApproved && isFreshSource(source) && <Button size="sm" onClick={() => reviewDocument(document, "APPROVE")} disabled={busy || !reviewNote.trim()}><BookOpenCheck className="mr-1 h-3.5 w-3.5" />Approve revision</Button>}{canReview && document.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => reviewDocument(document, "CHANGES_REQUESTED")} disabled={busy || !reviewNote.trim()}>Request changes</Button>}{canReview && document.status !== "RETIRED" && <Button size="sm" variant="ghost" onClick={() => reviewDocument(document, "RETIRE")} disabled={busy || !reviewNote.trim()}>Retire</Button>}{canReview && document.status === "RETIRED" && <Button size="sm" variant="outline" onClick={() => reviewDocument(document, "RESTORE")} disabled={busy || !reviewNote.trim()}>Restore as draft</Button>}</div>
              </div>
            ))}</div>}
          </article>
        ))}
      </section>

      {canEdit && <section className="rounded-xl border border-border/70 p-4 sm:p-5">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><FilePlus2 className="h-4 w-4" />{editingDocumentId ? "Edit knowledge draft" : "Create knowledge draft"}</h2>
        <p className="mb-4 text-xs text-muted-foreground">The document stays private until a distinct owner/admin approves it. Editing an active document immediately withdraws it from retrieval.</p>
        {approvedSources.length === 0 ? <p className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground">Approve an active, verified source before adding its documents.</p> : <form onSubmit={saveDocument} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Approved source<Select value={documentDraft.sourceId} onValueChange={(value) => setDocumentDraft({ ...documentDraft, sourceId: value })}><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger><SelectContent>{approvedSources.map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent></Select></label>
          <label className="text-sm">Locale<Select value={documentDraft.locale} onValueChange={(value) => setDocumentDraft({ ...documentDraft, locale: value as "en" | "ar" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">Arabic</SelectItem></SelectContent></Select></label>
          <Input aria-label="Document title" placeholder="Document title" value={documentDraft.title} onChange={(e) => setDocumentDraft({ ...documentDraft, title: e.target.value })} required maxLength={300} />
          <Input aria-label="Document slug" placeholder="URL-safe slug" value={documentDraft.slug} onChange={(e) => setDocumentDraft({ ...documentDraft, slug: e.target.value })} required maxLength={180} />
          <Textarea aria-label="Knowledge document content" className="min-h-52 md:col-span-2" placeholder="Paste or author reviewed knowledge text; do not include customer data." value={documentDraft.content} onChange={(e) => setDocumentDraft({ ...documentDraft, content: e.target.value })} minLength={41} maxLength={50_000} required />
          <Input aria-label="Change note" placeholder="Change note for revision history (optional)" value={documentDraft.changeNote} onChange={(e) => setDocumentDraft({ ...documentDraft, changeNote: e.target.value })} maxLength={300} />
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{documentDraft.content.length.toLocaleString()} / 50,000 characters</span><Button type="submit" disabled={busy || !documentDraft.sourceId || documentDraft.content.length < 41}><Save className="mr-2 h-4 w-4" />{editingDocumentId ? "Save draft" : "Create draft"}</Button></div>
          {editingDocumentId && <Button type="button" variant="outline" className="md:col-span-2" onClick={() => { setEditingDocumentId(null); setDocumentDraft(EMPTY_DOCUMENT); }}>Cancel editing</Button>}
        </form>}
      </section>}
      {documentList.some((document) => document.status === "ACTIVE" && document.chunkCount === 0) && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Approved documents are waiting for the local worker to build their searchable index.</p>}
    </div>
  );
}

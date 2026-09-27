"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/common";
import { toast } from "sonner";

type FaqGroup = "GENERAL" | "BUYING" | "SELLING" | "OFF_PLAN" | "INVESTMENT" | "INTERNATIONAL" | "AI_ADVISOR" | "PRIVACY";
type Faq = { id: string; groupKey: FaqGroup; locale: "en" | "ar"; question: string; answer: string; sortOrder: number; isActive: boolean; updatedAt: string };
type FaqForm = Omit<Faq, "id" | "updatedAt">;
const emptyForm: FaqForm = { groupKey: "GENERAL", locale: "en", question: "", answer: "", sortOrder: 0, isActive: true };

export function FaqsSection({ canEdit }: { canEdit: boolean }) {
  const [entries, setEntries] = React.useState<Faq[] | null>(null);
  const [editing, setEditing] = React.useState<Faq | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<FaqForm>(emptyForm);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    api.get<{ entries: Faq[] }>("/api/admin/faqs").then((result) => setEntries(result.entries)).catch(() => setEntries([]));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(emptyForm); };
  const openEdit = (entry: Faq) => {
    setEditing(entry);
    setCreating(false);
    setForm({ groupKey: entry.groupKey, locale: entry.locale, question: entry.question, answer: entry.answer, sortOrder: entry.sortOrder, isActive: entry.isActive });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (creating) {
        await api.post("/api/admin/faqs", form);
        toast.success("FAQ entry created");
      } else if (editing) {
        await api.patch("/api/admin/faqs", { faqId: editing.id, expectedUpdatedAt: editing.updatedAt, ...form });
        toast.success("FAQ entry saved");
      }
      setCreating(false);
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "FAQ save failed");
      if (error instanceof Error && error.message.toLowerCase().includes("changed since")) load();
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl font-semibold">Frequently asked questions</h1><p className="mt-1 text-sm text-muted-foreground">Manage localized plain-text answers. Deactivate to remove a question from public pages without deleting its history.</p></div>
      {canEdit && <Button onClick={openCreate}>Add FAQ</Button>}
    </header>
    {entries === null ? <LoadingState rows={4} /> : entries.length === 0 ? <EmptyState title="No FAQ entries" description="Add a question and answer for a supported locale." /> : <div className="overflow-x-safe rounded-xl border border-border/70">
      <table className="w-full min-w-[780px] text-sm">
        <thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Question</th><th className="p-3">Group</th><th className="p-3">Locale</th><th className="p-3">Order</th><th className="p-3">Visibility</th>{canEdit && <th className="p-3">Actions</th>}</tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-border/50"><td className="max-w-xl p-3"><p className="font-medium">{entry.question}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.answer}</p></td><td className="p-3"><Badge variant="outline">{entry.groupKey}</Badge></td><td className="p-3">{entry.locale.toUpperCase()}</td><td className="p-3 num">{entry.sortOrder}</td><td className="p-3"><Badge variant="outline">{entry.isActive ? "ACTIVE" : "HIDDEN"}</Badge></td>{canEdit && <td className="p-3"><Button size="sm" variant="outline" onClick={() => openEdit(entry)}>Edit</Button></td>}</tr>)}</tbody>
      </table>
    </div>}

    {canEdit && <Dialog open={creating || editing !== null} onOpenChange={(open) => { if (!open && !saving) { setCreating(false); setEditing(null); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{creating ? "Add FAQ entry" : "Edit FAQ entry"}</DialogTitle><DialogDescription>Answers are plain text and are rendered as text, never as HTML. Every edit is recorded in the audit history. Hiding is reversible.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium">Group<Select value={form.groupKey} onValueChange={(groupKey) => setForm({ ...form, groupKey: groupKey as FaqGroup })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["GENERAL", "BUYING", "SELLING", "OFF_PLAN", "INVESTMENT", "INTERNATIONAL", "AI_ADVISOR", "PRIVACY"] as FaqGroup[]).map((group) => <SelectItem key={group} value={group}>{group.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1.5 text-sm font-medium">Locale<Select value={form.locale} onValueChange={(locale) => setForm({ ...form, locale: locale as "en" | "ar" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">Arabic</SelectItem></SelectContent></Select></label>
            <label className="space-y-1.5 text-sm font-medium">Sort order<Input type="number" min={0} max={10000} step={1} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Question<Input required maxLength={500} dir={form.locale === "ar" ? "rtl" : "ltr"} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium">Answer<Textarea required maxLength={5000} rows={8} dir={form.locale === "ar" ? "rtl" : "ltr"} value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} /></label>
          <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Visible on public pages</span><span className="text-xs text-muted-foreground">Turn off to retain this entry without publishing it.</span></span><Switch checked={form.isActive} onCheckedChange={(isActive) => setForm({ ...form, isActive })} /></label>
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : creating ? "Create FAQ" : "Save changes"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
  </div>;
}

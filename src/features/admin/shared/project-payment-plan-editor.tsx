"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PublicMediaPicker } from "@/features/admin/shared/public-media-picker";
import { toast } from "sonner";
import { fromMinor, toMinor } from "@/lib/money";

type Installment = { label: string; percent: number; dueOffsetMonths: number | null; amountMinor: string | null };
type Plan = {
  id: string; projectId: string; name: string; currency: string; postHandover: boolean;
  sourceDocumentId: string | null; verificationStatus: "UNVERIFIED" | "PUBLISHED" | "VERIFIED";
  validFrom: string | null; validTo: string | null; notes: string | null; isDefault: boolean;
  updatedAt: string; installments: Installment[];
};

const blank = (): Omit<Plan, "id" | "projectId" | "updatedAt"> => ({
  name: "", currency: "AED", postHandover: false, sourceDocumentId: null,
  verificationStatus: "UNVERIFIED", validFrom: null, validTo: null, notes: null,
  isDefault: false, installments: [{ label: "Booking", percent: 100, dueOffsetMonths: 0, amountMinor: null }],
});

export function ProjectPaymentPlanEditor({ projectId, initialCount = 0, onChanged }: { projectId: string; initialCount?: number; onChanged?: () => void }) {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [form, setForm] = React.useState(blank());
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const total = form.installments.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);

  const load = React.useCallback(async () => {
    try {
      const result = await api.get<{ paymentPlans: Plan[] }>(`/api/admin/projects/payment-plans?projectId=${encodeURIComponent(projectId)}`);
      setPlans(result.paymentPlans);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Payment plans could not be loaded"); }
  }, [projectId]);
  React.useEffect(() => { if (expanded) void load(); }, [expanded, load]);

  const startEdit = (plan: Plan) => {
    const { id, projectId: _projectId, updatedAt: _updatedAt, ...values } = plan;
    setEditingId(id);
    setForm({ ...values, installments: values.installments.map((item) => ({ ...item, amountMinor: item.amountMinor == null ? null : String(fromMinor(item.amountMinor)) })) });
    setExpanded(true);
  };
  const startNew = () => { setEditingId(null); setForm(blank()); setExpanded(true); };
  const cancel = () => { setEditingId(null); setForm(blank()); };
  const submit = async () => {
    if (Math.abs(total - 100) > 0.01) { toast.error(`Installments total ${total.toFixed(2)}%. They must total 100%.`); return; }
    setBusy(true);
    try {
      const values = { ...form, sourceDocumentId: form.sourceDocumentId || null, validFrom: form.validFrom || null, validTo: form.validTo || null, notes: form.notes || null, installments: form.installments.map((item) => ({ ...item, amountMinor: item.amountMinor ? toMinor(item.amountMinor).toString() : null })) };
      if (editingId) {
        const plan = plans.find((item) => item.id === editingId);
        if (!plan) throw new Error("Payment plan changed. Reload the project and retry.");
        await api.patch("/api/admin/projects/payment-plans", { ...values, planId: editingId, expectedUpdatedAt: plan.updatedAt });
      } else await api.post("/api/admin/projects/payment-plans", { ...values, projectId });
      toast.success(editingId ? "Payment plan updated" : "Payment plan created");
      cancel(); await load(); onChanged?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Payment plan could not be saved"); }
    finally { setBusy(false); }
  };

  return <section className="space-y-3 rounded-lg border border-border/70 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Payment plans</h3><p className="text-xs text-muted-foreground">{plans.length || initialCount} plan(s). Only plans marked Published or Verified appear publicly; Verified requires a source PDF.</p></div><Button type="button" size="sm" variant="outline" onClick={() => expanded ? setExpanded(false) : startNew()}>{expanded ? "Hide editor" : "Add payment plan"}</Button></div>
    {expanded && <>
      {plans.length > 0 && <ul className="space-y-2">{plans.map((plan) => <li key={plan.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2 text-xs"><span className="min-w-0 flex-1 font-medium">{plan.name}{plan.isDefault ? " · Default" : ""} · {plan.verificationStatus} · {plan.installments.length} installments</span><Button type="button" size="sm" variant="outline" onClick={() => startEdit(plan)}>Edit</Button></li>)}</ul>}
      <div className="space-y-3 rounded-md bg-muted/30 p-3">
        <h4 className="text-sm font-medium">{editingId ? "Edit payment plan" : "New payment plan"}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">Plan name<Input required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="space-y-1 text-xs">Currency<Input required maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
          <label className="space-y-1 text-xs">Publication<select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.verificationStatus} onChange={(e) => setForm({ ...form, verificationStatus: e.target.value as Plan["verificationStatus"] })}><option value="UNVERIFIED">Draft — hidden publicly</option><option value="PUBLISHED">Published</option><option value="VERIFIED">Verified from source document</option></select></label>
          <div className="grid grid-cols-2 gap-2"><label className="space-y-1 text-xs">Valid from<Input type="date" value={form.validFrom ?? ""} onChange={(e) => setForm({ ...form, validFrom: e.target.value || null })} /></label><label className="space-y-1 text-xs">Valid to<Input type="date" value={form.validTo ?? ""} onChange={(e) => setForm({ ...form, validTo: e.target.value || null })} /></label></div>
        </div>
        <PublicMediaPicker label="Source PDF (required for Verified)" value={form.sourceDocumentId ?? ""} allowedKinds={["DOCUMENT", "BROCHURE"]} onChange={(sourceDocumentId) => setForm({ ...form, sourceDocumentId: sourceDocumentId || null })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />Default plan</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.postHandover} onChange={(e) => setForm({ ...form, postHandover: e.target.checked })} />Includes post-handover payments</label>
        <div className="space-y-2"><div className="flex items-center justify-between"><h5 className="text-sm font-medium">Installments <span className={Math.abs(total - 100) < 0.01 ? "text-success" : "text-destructive"}>· {total.toFixed(2)}%</span></h5><Button type="button" size="sm" variant="outline" disabled={form.installments.length >= 24} onClick={() => setForm({ ...form, installments: [...form.installments, { label: "", percent: 0, dueOffsetMonths: null, amountMinor: null }] })}>Add row</Button></div>
          {form.installments.map((row, index) => <div key={index} className="grid grid-cols-[minmax(7rem,1fr)_5.5rem_6.5rem_6.5rem_auto] items-center gap-2"><Input aria-label={`Installment ${index + 1} label`} maxLength={160} value={row.label} onChange={(e) => setForm({ ...form, installments: form.installments.map((item, i) => i === index ? { ...item, label: e.target.value } : item) })} placeholder="Stage" /><Input aria-label={`Installment ${index + 1} percent`} type="number" min="0.01" max="100" step="0.01" value={row.percent} onChange={(e) => setForm({ ...form, installments: form.installments.map((item, i) => i === index ? { ...item, percent: Number(e.target.value) } : item) })} /><Input aria-label={`Installment ${index + 1} months`} type="number" min="-240" max="240" value={row.dueOffsetMonths ?? ""} onChange={(e) => setForm({ ...form, installments: form.installments.map((item, i) => i === index ? { ...item, dueOffsetMonths: e.target.value ? Number(e.target.value) : null } : item) })} placeholder="Month" /><Input aria-label={`Installment ${index + 1} amount`} type="number" min="0" step="0.01" value={row.amountMinor ?? ""} onChange={(e) => setForm({ ...form, installments: form.installments.map((item, i) => i === index ? { ...item, amountMinor: e.target.value || null } : item) })} placeholder="Amount" /><Button type="button" variant="outline" size="sm" aria-label={`Remove installment ${index + 1}`} disabled={form.installments.length <= 1} onClick={() => setForm({ ...form, installments: form.installments.filter((_, i) => i !== index) })}>×</Button></div>)}
          <p className="text-[11px] text-muted-foreground">Optional amounts use the selected plan currency. Due month is relative to booking or handover; negative values represent pre-launch stages.</p>
        </div>
        <Textarea maxLength={2000} rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} placeholder="Internal notes or terms" aria-label="Payment plan notes" />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={cancel}>Cancel</Button><Button type="button" disabled={busy || Math.abs(total - 100) > 0.01} onClick={() => void submit()}>{busy ? "Saving…" : "Save plan"}</Button></div>
      </div>
    </>}
  </section>;
}

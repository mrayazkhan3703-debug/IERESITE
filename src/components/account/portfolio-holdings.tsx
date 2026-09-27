"use client";

/**
 * Holdings list + CRUD form (V2 §25.1/§25.3, U15). Add a holding manually or
 * import from the favorites tray (prefill from the listing card). Editing and
 * deletion are inline with confirmation — no destructive action without an
 * explicit confirm step.
 */
import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSavedStore } from "@/components/providers/saved-provider";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api-client";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatDate, formatNumber } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Heart, Keyboard, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { ValuationBasisChip } from "./portfolio-summary";
import type { PortfolioData, PortfolioHolding } from "./portfolio-types";

interface FormState {
  label: string;
  propertySlug: string | null;
  purchasePrice: string;
  purchaseDate: string;
  rentAnnual: string;
  sizeSqft: string;
  serviceChargePerSqft: string;
  notes: string;
  hasMortgage: boolean;
  mortgageBalance: string;
  mortgageMonthly: string;
  mortgageRate: string;
  mortgageTerm: string;
}

const EMPTY_FORM: FormState = {
  label: "",
  propertySlug: null,
  purchasePrice: "",
  purchaseDate: "",
  rentAnnual: "",
  sizeSqft: "",
  serviceChargePerSqft: "",
  notes: "",
  hasMortgage: false,
  mortgageBalance: "",
  mortgageMonthly: "",
  mortgageRate: "",
  mortgageTerm: "",
};

const num = (v: string): number | undefined => {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function PortfolioHoldings({
  data,
  onRefresh,
}: {
  data: PortfolioData;
  onRefresh: () => void;
}) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string, vars?: Record<string, string>) => {
    let s = t(key, locale);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
  const { toast } = useToast();
  const favorites = useSavedStore((s) => s.favorites);

  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"import" | "manual">("import");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>({ ...EMPTY_FORM });
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setMode(favorites.length > 0 ? "import" : "manual");
    setError(null);
    setOpen(true);
  };

  const openEdit = (h: PortfolioHolding) => {
    setEditingId(h.id);
    setError(null);
    setOpen(true);
    setForm({
      label: h.label,
      propertySlug: h.propertySlug,
      purchasePrice: String(Number(h.purchasePriceMinor) / 100),
      purchaseDate: h.purchaseDate ? h.purchaseDate.slice(0, 10) : "",
      rentAnnual: h.rentAnnualMinor ? String(Number(h.rentAnnualMinor) / 100) : "",
      sizeSqft: h.sizeSqft ? String(h.sizeSqft) : "",
      serviceChargePerSqft: h.serviceChargePerSqft ? String(h.serviceChargePerSqft) : "",
      notes: h.notes ?? "",
      hasMortgage: !!h.mortgage,
      mortgageBalance: h.mortgage ? String(Number(h.mortgage.balanceMinor) / 100) : "",
      mortgageMonthly: h.mortgage && Number(h.mortgage.monthlyPaymentMinor) > 0 ? String(Number(h.mortgage.monthlyPaymentMinor) / 100) : "",
      mortgageRate: h.mortgage?.ratePct != null ? String(h.mortgage.ratePct) : "",
      mortgageTerm: h.mortgage?.termYears != null ? String(h.mortgage.termYears) : "",
    });
  };

  const importFavorite = (slug: string) => {
    const fav = favorites.find((f) => f.slug === slug);
    if (!fav) return;
    set({
      propertySlug: fav.slug,
      label: fav.title,
      purchasePrice: fav.price?.minor ? String(Number(fav.price.minor) / 100) : form.purchasePrice,
      sizeSqft: fav.areaSqft ? String(Math.round(fav.areaSqft)) : form.sizeSqft,
    });
  };

  const validate = (): string | null => {
    if (form.label.trim().length < 2) return t_("portfolio.field.label") + " — minimum 2 characters.";
    if (!num(form.purchasePrice)) return t_("portfolio.field.purchasePrice") + " — enter a positive amount.";
    if (form.hasMortgage && !num(form.mortgageBalance)) return t_("portfolio.mortgage.balance") + " — enter a positive amount or turn the mortgage off.";
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      label: form.label.trim(),
      propertySlug: form.propertySlug ?? undefined,
      purchasePrice: num(form.purchasePrice),
      purchaseDate: form.purchaseDate || undefined,
      rentAnnual: num(form.rentAnnual) ?? undefined,
      sizeSqft: num(form.sizeSqft) ?? undefined,
      serviceChargePerSqft: num(form.serviceChargePerSqft) ?? undefined,
      notes: form.notes.trim() || undefined,
      mortgage: form.hasMortgage
        ? {
            balance: num(form.mortgageBalance)!,
            monthlyPayment: num(form.mortgageMonthly),
            ratePct: num(form.mortgageRate),
            termYears: num(form.mortgageTerm),
          }
        : undefined,
    };
    try {
      if (editingId) {
        await api.patch(`/api/account/portfolio/${editingId}`, payload);
      } else {
        await api.post("/api/account/portfolio", payload);
      }
      toast({ title: t_("portfolio.holdings.saved") });
      setOpen(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Saving failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async (id: string) => {
    try {
      await api.delete(`/api/account/portfolio/${id}`);
      toast({ title: t_("portfolio.holdings.deleted") });
      setPendingDelete(null);
      onRefresh();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{t_("portfolio.holdings.title")}</h2>
        <Button size="sm" className="gap-1.5" onClick={openCreate} disabled={open && !editingId}>
          <Plus className="h-4 w-4" aria-hidden /> {t_("portfolio.holdings.add")}
        </Button>
      </div>

      {data.holdings.length === 0 && !open && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-sand/30 px-5 py-10 text-center text-sm text-muted-foreground">
          {t_("portfolio.holdings.empty")}
        </p>
      )}

      {/* Add / edit form */}
      {open && (
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 rounded-xl border border-brand/40 bg-card p-5"
          aria-label={editingId ? t_("portfolio.holdings.edit") : t_("portfolio.holdings.add")}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{editingId ? t_("portfolio.holdings.edit") : t_("portfolio.holdings.add")}</h3>
            {!editingId && (
              <div className="flex gap-1 rounded-lg border border-border p-1" role="tablist" aria-label="Entry mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "import"}
                  disabled={favorites.length === 0}
                  onClick={() => setMode("import")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-ui disabled:opacity-40",
                    mode === "import" ? "bg-brand-soft text-brand-strong" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Heart className="h-3.5 w-3.5" aria-hidden /> {t_("portfolio.holdings.import")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "manual"}
                  onClick={() => setMode("manual")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-ui",
                    mode === "manual" ? "bg-brand-soft text-brand-strong" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Keyboard className="h-3.5 w-3.5" aria-hidden /> {t_("portfolio.holdings.manual")}
                </button>
              </div>
            )}
          </div>

          {!editingId && mode === "import" && (
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="pf-favorite">{t_("account.nav.favorites")}</Label>
              <select
                id="pf-favorite"
                value=""
                onChange={(e) => e.target.value && importFavorite(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-ui focus:border-brand/60"
              >
                <option value="">
                  {favorites.length === 0 ? "No favorites yet — switch to manual entry" : "Choose a favorite to prefill…"}
                </option>
                {favorites.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.title} · {f.community.name}
                  </option>
                ))}
              </select>
              {form.propertySlug && (
                <p className="text-xs text-muted-foreground">
                  Prefilled from <Link to={`/properties/${form.propertySlug}`} className="text-brand-strong underline underline-offset-2">your saved listing</Link> — adjust anything below.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-label">{t_("portfolio.field.label")} *</Label>
              <Input id="pf-label" required value={form.label} onChange={(e) => set({ label: e.target.value })} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-price">{t_("portfolio.field.purchasePrice")} *</Label>
              <Input
                id="pf-price"
                required
                inputMode="numeric"
                className="num"
                value={form.purchasePrice}
                onChange={(e) => set({ purchasePrice: e.target.value })}
                aria-describedby="pf-price-hint"
              />
              <p id="pf-price-hint" className="text-[11px] text-muted-foreground">Full amount in AED, e.g. 2150000.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-date">{t_("portfolio.field.purchaseDate")}</Label>
              <Input id="pf-date" type="date" value={form.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value })} className="num" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-rent">{t_("portfolio.field.rentAnnual")}</Label>
              <Input id="pf-rent" inputMode="numeric" className="num" value={form.rentAnnual} onChange={(e) => set({ rentAnnual: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-size">{t_("portfolio.field.size")}</Label>
              <Input id="pf-size" inputMode="numeric" className="num" value={form.sizeSqft} onChange={(e) => set({ sizeSqft: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-service">{t_("portfolio.field.serviceCharge")}</Label>
              <Input id="pf-service" inputMode="numeric" className="num" value={form.serviceChargePerSqft} onChange={(e) => set({ serviceChargePerSqft: e.target.value })} />
            </div>
          </div>

          {/* Mortgage */}
          <fieldset className="mt-4 rounded-lg border border-border bg-sand/40 p-4">
            <legend className="px-1 text-sm font-medium">{t_("portfolio.mortgage.title")}</legend>
            <div className="flex items-center gap-2.5">
              <Switch id="pf-mortgage" checked={form.hasMortgage} onCheckedChange={(v) => set({ hasMortgage: v })} aria-label={t_("portfolio.mortgage.title")} />
              <Label htmlFor="pf-mortgage" className="text-sm text-muted-foreground">Track a mortgage on this holding</Label>
            </div>
            {form.hasMortgage && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pf-mbal">{t_("portfolio.mortgage.balance")} *</Label>
                  <Input id="pf-mbal" inputMode="numeric" className="num" value={form.mortgageBalance} onChange={(e) => set({ mortgageBalance: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-mmonthly">{t_("portfolio.mortgage.monthly")}</Label>
                  <Input id="pf-mmonthly" inputMode="numeric" className="num" value={form.mortgageMonthly} onChange={(e) => set({ mortgageMonthly: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-mrate">{t_("portfolio.mortgage.rate")}</Label>
                  <Input id="pf-mrate" inputMode="decimal" className="num" value={form.mortgageRate} onChange={(e) => set({ mortgageRate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-mterm">{t_("portfolio.mortgage.term")}</Label>
                  <Input id="pf-mterm" inputMode="numeric" className="num" value={form.mortgageTerm} onChange={(e) => set({ mortgageTerm: e.target.value })} />
                </div>
              </div>
            )}
          </fieldset>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="pf-notes">{t_("portfolio.field.notes")}</Label>
            <textarea
              id="pf-notes"
              rows={2}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-ui focus:border-brand/60"
            />
          </div>

          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editingId ? t_("portfolio.holdings.edit") : t_("portfolio.holdings.add")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setEditingId(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Holdings list */}
      <ul className="mt-4 space-y-3">
        {data.holdings.map((h) => (
          <li key={h.id} className="rounded-xl border border-border/70 bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold">{h.label}</h3>
                  <ValuationBasisChip basis={h.valuation.basis} />
                  {h.community && (
                    <span className="text-xs text-muted-foreground">
                      {h.community.name}
                      {h.projectSlug && " · off-plan project"}
                    </span>
                  )}
                </div>
                <p className="num mt-1 text-sm text-muted-foreground">
                  {t_("portfolio.field.purchasePrice")}: {formatAEDPrecise(Number(h.purchasePriceMinor) / 100)}
                  {h.purchaseDate && ` · ${formatDate(h.purchaseDate)}`}
                  {h.sizeSqft && ` · ${formatNumber(h.sizeSqft)} sqft`}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">{h.valuation.basisNote}</p>
                {h.notes && <p className="mt-1.5 text-xs text-muted-foreground">{h.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {h.href && (
                  <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2.5 text-xs">
                    <Link to={h.href}>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> View
                    </Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={() => openEdit(h)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> {t_("portfolio.holdings.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setPendingDelete(pendingDelete === h.id ? null : h.id)}
                  aria-expanded={pendingDelete === h.id}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t_("portfolio.holdings.delete")}
                </Button>
              </div>
            </div>

            {pendingDelete === h.id && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
                <p className="text-sm text-destructive">{t_("portfolio.holdings.deleteConfirm")}</p>
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={() => confirmDelete(h.id)}>Delete</Button>
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Keep</Button>
                </div>
              </div>
            )}

            <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">{t_("portfolio.summary.value")}</dt>
                <dd className="mt-0.5 font-semibold" title={String(Number(h.valuation.minor) / 100)}>
                  {formatAEDPrecise(Number(h.valuation.minor) / 100)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t_("portfolio.summary.equity")}</dt>
                <dd className="mt-0.5 font-semibold">
                  {h.equityMinor !== null ? formatAEDPrecise(Number(h.equityMinor) / 100) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t_("portfolio.summary.grossYield")}</dt>
                <dd className="mt-0.5 font-semibold">{h.yield ? formatPctPrecise(h.yield.grossYieldPct) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t_("portfolio.summary.netYield")}</dt>
                <dd className="mt-0.5 font-semibold">{h.yield ? formatPctPrecise(h.yield.netYieldPct) : "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

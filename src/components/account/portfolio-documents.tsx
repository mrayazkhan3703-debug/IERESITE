"use client";

/**
 * Portfolio documents (V2 §25.6, U15): category cards for SPA / title deed /
 * Oqood / receipts / floor plan / mortgage / tenancy with per-category upload
 * (existing media pipeline: magic-byte sniffing + size caps) and strict
 * owner-only listing/deletion. Files land in the user's private document
 * store — GET only ever returns the signed-in owner's rows.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FileText, Loader2, Trash2, Upload, ShieldCheck } from "lucide-react";
import { DOC_CATEGORIES, type PortfolioDocumentRow, type PortfolioHolding } from "./portfolio-types";

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  SPA: FileText,
  TITLE_DEED: ShieldCheck,
  OQOOD: FileText,
  RECEIPT: FileText,
  FLOOR_PLAN: FileText,
  MORTGAGE: FileText,
  TENANCY: FileText,
};

export function PortfolioDocuments({ holdings, refreshSignal }: { holdings: PortfolioHolding[]; refreshSignal: number }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const { toast } = useToast();

  const [docs, setDocs] = React.useState<PortfolioDocumentRow[] | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [linkHolding, setLinkHolding] = React.useState<string>("");

  const load = React.useCallback(() => {
    api
      .get<{ documents: PortfolioDocumentRow[] }>("/api/account/portfolio/documents")
      .then((r) => setDocs(r.documents))
      .catch(() => setDocs([]));
  }, []);

  React.useEffect(load, [load, refreshSignal]);

  const upload = async (category: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (linkHolding) form.append("holdingId", linkHolding);
    form.append("label", file.name.slice(0, 160));
    setUploading(category);
    try {
      await api.upload("/api/account/portfolio/documents", form);
      toast({ title: "Document uploaded", description: `${category} · ${file.name}` });
      load();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof ApiError ? err.message : "Please try again (JPEG, PNG, WebP, AVIF or PDF).",
        variant: "destructive",
      });
    } finally {
      setUploading(null);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/api/account/portfolio/documents/${id}`);
      toast({ title: "Document removed" });
      load();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div>
      <h2 className="font-display text-lg font-semibold">{t_("portfolio.docs.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t_("portfolio.docs.sub")}</p>

      {holdings.length > 0 && (
        <div className="mt-4 max-w-sm space-y-1.5">
          <Label htmlFor="pd-holding">{t_("portfolio.docs.linkHolding")}</Label>
          <select
            id="pd-holding"
            value={linkHolding}
            onChange={(e) => setLinkHolding(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-ui focus:border-brand/60"
          >
            <option value="">Not linked</option>
            {holdings.map((h) => (
              <option key={h.id} value={h.id}>{h.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat] ?? FileText;
          const catDocs = (docs ?? []).filter((d) => d.category === cat);
          const busy = uploading === cat;
          return (
            <div key={cat} className="flex flex-col rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-brand" aria-hidden />
                <h3 className="text-sm font-semibold">{t_(`portfolio.docs.category.${cat}`)}</h3>
                <span className="num ml-auto text-xs text-muted-foreground">{catDocs.length}</span>
              </div>

              <ul className="mt-3 flex-1 space-y-2">
                {docs === null && <li className="text-xs text-muted-foreground">Loading…</li>}
                {docs !== null && catDocs.length === 0 && (
                  <li className="text-xs text-muted-foreground">{t_("portfolio.docs.empty")}</li>
                )}
                {catDocs.map((d) => (
                  <li key={d.id} className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={d.media.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-xs font-medium underline underline-offset-2 hover:text-brand-strong"
                        title={d.label ?? d.media.url}
                      >
                        {d.label ?? "Document"}
                      </a>
                      <button
                        type="button"
                        onClick={() => remove(d.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-ui hover:text-destructive"
                        aria-label={`${t_("portfolio.docs.delete")} ${d.label ?? d.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {(d.media.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}
                      {d.holdingLabel && ` · ${d.holdingLabel}`}
                    </p>
                  </li>
                ))}
              </ul>

              <label
                className={cn(
                  "mt-3 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-ui hover:border-brand/50 hover:text-brand-strong",
                  busy && "pointer-events-none opacity-60"
                )}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t_("portfolio.docs.uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" aria-hidden /> {t_("portfolio.docs.upload")}
                  </>
                )}
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
                  disabled={busy}
                  aria-label={`${t_("portfolio.docs.upload")} — ${t_(`portfolio.docs.category.${cat}`)}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(cat, f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t_("portfolio.docs.hint")}</p>
    </div>
  );
}

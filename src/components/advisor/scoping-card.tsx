"use client";

/**
 * Scoping card (V2 §22 — ?property= / ?project= entry).
 *
 * When the advisor is opened from a property or project page, the entity is
 * fetched and shown as a compact context chip above the conversation; its slug
 * is also injected into the server-side system prompt (see advisor.ts scope).
 * "Clear scope" removes the URL param — the conversation continues unscoped.
 */
import { mediaPreviewUrl } from "@/lib/media-preview";
import * as React from "react";
import { api } from "@/lib/api-client";
import { t, type Locale } from "@/lib/i18n";
import { formatAEDPrecise } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { X, MapPin, Building2, BedDouble, HardHat, Layers, CalendarClock } from "lucide-react";

export type ScopeKind = "property" | "project";

interface ScopedProperty {
  slug: string;
  title: string;
  bedrooms: number;
  community: { name: string };
  listing: { priceMinor: string; listingType: string } | null;
  media: { url: string; altText?: string | null; kind?: string; mimeType?: string; posterUrl?: string | null }[];
}

interface ScopedProject {
  slug: string;
  name: string;
  developer: { name: string } | null;
  community: { name: string } | null;
  startingPriceMinor: string | null;
  handoverDate: string | null;
  status: string;
  completionPercent: number | null;
  media: { url: string; altText?: string | null; kind?: string; mimeType?: string; posterUrl?: string | null }[];
}

export function ScopingCard({
  kind,
  slug,
  locale,
  onClear,
}: {
  kind: ScopeKind;
  slug: string;
  locale: Locale;
  onClear: () => void;
}) {
  const [data, setData] = React.useState<ScopedProperty | ScopedProject | null>(null);
  const [state, setState] = React.useState<"loading" | "ok" | "notfound">("loading");

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    api
      .get<ScopedProperty | ScopedProject>(`/api/${kind === "property" ? "properties" : "projects"}/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setState("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setState("notfound");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, slug]);

  const clearBtn = (
    <button
      type="button"
      onClick={onClear}
      aria-label={t("advisorV2.scoped.clear", locale)}
      title={t("advisorV2.scoped.clear", locale)}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-ui hover:bg-warning/10 hover:text-warning"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );

  if (state === "notfound") {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-warning/10 px-4 py-2.5 text-xs text-warning">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          {t("advisorV2.scoped.notFound", locale)}
        </span>
        {clearBtn}
      </div>
    );
  }

  if (state === "loading" || !data) {
    return (
      <div className="flex items-center gap-3 border-b border-border/70 bg-sand/40 px-4 py-2.5">
        <div className="h-11 w-[72px] animate-pulse rounded-md bg-border/60" aria-hidden />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-48 animate-pulse rounded bg-border/60" aria-hidden />
          <div className="h-3 w-32 animate-pulse rounded bg-border/60" aria-hidden />
        </div>
        <span className="sr-only">{t("advisorV2.scoped.loading", locale)}</span>
        {clearBtn}
      </div>
    );
  }

  if (kind === "property") {
    const p = data as ScopedProperty;
    const price = p.listing ? Number(p.listing.priceMinor) / 100 : null;
    return (
      <div className="flex items-center gap-3 border-b border-border/70 bg-sand/40 px-4 py-2.5">
        <div className="h-11 w-[72px] shrink-0 overflow-hidden rounded-md bg-sand">
          {mediaPreviewUrl(p.media?.[0]) ? (
            <img src={mediaPreviewUrl(p.media[0]) ?? undefined} alt={p.media[0].altText ?? p.title} width={72} height={44} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40"><Layers className="h-4 w-4" aria-hidden /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-strong">{t("advisorV2.scoped.property", locale)}</p>
          <p className="truncate text-sm font-semibold leading-tight" title={p.title}>{p.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
            {price != null ? <span className="num font-semibold text-foreground">{formatAEDPrecise(price)}</span> : null}
            <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3 text-brand" aria-hidden />{p.community.name}</span>
            <span className="num inline-flex items-center gap-0.5"><BedDouble className="h-3 w-3 text-brand" aria-hidden />{p.bedrooms === 0 ? t("advisorV2.card.studio", locale) : formatNumber(p.bedrooms)}</span>
          </p>
        </div>
        {clearBtn}
      </div>
    );
  }

  const j = data as ScopedProject;
  const from = j.startingPriceMinor ? Number(j.startingPriceMinor) / 100 : null;
  const handover = j.handoverDate ? new Date(j.handoverDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  return (
    <div className={cn("flex items-center gap-3 border-b border-border/70 bg-sand/40 px-4 py-2.5")}>
    <div className="h-11 w-[72px] shrink-0 overflow-hidden rounded-md bg-sand">
      {mediaPreviewUrl(j.media?.[0]) ? (
        <img src={mediaPreviewUrl(j.media[0]) ?? undefined} alt={j.media[0].altText ?? j.name} width={72} height={44} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40"><Building2 className="h-4 w-4" aria-hidden /></div>
      )}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-strong">{t("advisorV2.scoped.project", locale)}</p>
      <p className="truncate text-sm font-semibold leading-tight" title={j.name}>{j.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
        {from != null ? <span className="num font-semibold text-foreground">{t("advisorV2.card.from", locale)} {formatAEDPrecise(from)}</span> : null}
        {j.developer ? <span className="inline-flex items-center gap-0.5"><HardHat className="h-3 w-3 text-brand" aria-hidden />{j.developer.name}</span> : null}
        {handover ? <span className="inline-flex items-center gap-0.5"><CalendarClock className="h-3 w-3 text-brand" aria-hidden />{handover}</span> : null}
      </p>
    </div>
    {clearBtn}
  </div>
  );
}

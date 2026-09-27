"use client";

/**
 * Structured attachment renderers for the AI Advisor V2 (§22.4/§22.5).
 *
 * The advisor orchestrator attaches tool results to each turn as a typed
 * `attachments` array; these renderers turn them into rich UI (property cards,
 * project/community cards, comparison tables, payment timelines, scenario
 * cards, source cards) instead of forcing everything into prose.
 *
 * Compatibility: messages without attachments (V1 restores, older turns)
 * simply render no attachment block.
 */
import * as React from "react";
import { Link } from "@/lib/router";
import { DataStateBadge, UnavailableValue } from "@/components/common";
import { t, type Locale } from "@/lib/i18n";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  BedDouble,
  Bath,
  Ruler,
  MapPin,
  ArrowRight,
  Building2,
  CalendarClock,
  HardHat,
  ExternalLink,
  BookOpen,
  Layers,
  AlertTriangle,
  Landmark,
  TrendingUp,
} from "lucide-react";

/* Client-side mirrors of the server attachment protocol (src/server/ai/attachments.ts).
 * Duplicated by design — the client never imports server modules (V1 pattern). */
export interface AttachmentSource {
  state: "VERIFIED_SOURCE" | "APPROVED_INTERNAL" | "MODELED" | "USER_INPUT" | "ILLUSTRATIVE" | "STALE" | "UNAVAILABLE";
  asOf?: string | null;
  note?: string | null;
}

export interface PropertyCardAttachment {
  kind: "property_card";
  slug: string;
  title: string;
  community: string;
  project: string | null;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceAed: number;
  availability: string;
  offPlan: boolean;
  coverUrl?: string | null;
  url: string;
  source: AttachmentSource;
}

export interface ProjectCardAttachment {
  kind: "project_card";
  slug: string;
  name: string;
  developer: string | null;
  community: string | null;
  status: string;
  handoverDate: string | null;
  completionPercent: number | null;
  startingPriceAed: number | null;
  url: string;
  source: AttachmentSource;
}

export interface CommunityCardAttachment {
  kind: "community_card";
  slug: string;
  name: string;
  summary: string | null;
  avgPricePerSqftAed: number | null;
  url: string;
  source: AttachmentSource;
}

export interface ComparisonTableAttachment {
  kind: "comparison_table";
  title: string;
  columns: string[];
  rows: { metric: string; cells: string[] }[];
  urls: (string | null)[];
  source: AttachmentSource;
}

export interface PaymentTimelineAttachment {
  kind: "payment_timeline";
  purchasePriceAed: number;
  stages: { name: string; percent: number; amount: number; cumulative: number; dueLabel: string }[];
  valid: boolean;
  totalPercent: number;
  validationErrors: string[];
  engineVersion: string;
  source: AttachmentSource;
}

export interface ScenarioAttachment {
  kind: "scenario";
  metric: "roi";
  purchasePriceAed: number;
  annualRentAed: number;
  horizonYears: number;
  irrPct: number | null;
  breakEvenYear: number | null;
  scenarios: { key: "downside" | "base" | "upside"; netYieldPct: number; totalReturnAed: number; totalReturnPct: number }[];
  engineVersion: string;
  source: AttachmentSource;
}

export interface SourceCardAttachment {
  kind: "source_card";
  title: string;
  trustTier?: string | null;
  verifiedAt?: string | null;
  url?: string | null;
  excerpt?: string | null;
  source: AttachmentSource;
}

export type AdvisorAttachment =
  | PropertyCardAttachment
  | ProjectCardAttachment
  | CommunityCardAttachment
  | ComparisonTableAttachment
  | PaymentTimelineAttachment
  | ScenarioAttachment
  | SourceCardAttachment;

function freshnessLabel(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ *
 * Per-kind renderers
 * ------------------------------------------------------------------ */

function PropertyAttachmentCard({ a, locale }: { a: PropertyCardAttachment; locale: Locale }) {
  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <Link to={a.url} className="group flex h-full flex-col focus-visible:outline-offset-[-2px]">
        <div className="flex gap-3 p-2.5">
          <div className="relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded-md bg-sand">
            {a.coverUrl ? (
              <img
                src={a.coverUrl}
                alt={a.title}
                loading="lazy"
                decoding="async"
                width={96}
                height={72}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                <Layers className="h-6 w-6" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="line-clamp-2 text-[13px] font-semibold leading-snug group-hover:text-brand-strong">{a.title}</h4>
            <p className="num mt-1 text-sm font-semibold" title={`${formatAEDPrecise(a.priceAed)} — asking price`}>
              {formatAEDPrecise(a.priceAed)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3 text-brand" aria-hidden />
                {a.community}
              </span>
              <span className="num inline-flex items-center gap-0.5">
                <BedDouble className="h-3 w-3 text-brand" aria-hidden />
                {a.bedrooms === 0 ? t("advisorV2.card.studio", locale) : a.bedrooms}
              </span>
              <span className="num inline-flex items-center gap-0.5">
                <Bath className="h-3 w-3 text-brand" aria-hidden />
                {a.bathrooms}
              </span>
              {a.areaSqft ? (
                <span className="num inline-flex items-center gap-0.5">
                  <Ruler className="h-3 w-3 text-brand" aria-hidden />
                  {formatNumber(a.areaSqft)} sqft
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}

function ProjectAttachmentCard({ a, locale }: { a: ProjectCardAttachment; locale: Locale }) {
  const handover = a.handoverDate ? new Date(a.handoverDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  return (
    <article className="rounded-lg border border-border/60 bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
            <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            {a.name}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {a.developer ? <span className="inline-flex items-center gap-1"><HardHat className="h-3 w-3 text-brand" aria-hidden />{a.developer}</span> : null}
            {a.community ? <span className="ml-2 inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-brand" aria-hidden />{a.community}</span> : null}
          </p>
        </div>
        <Link
          to={a.url}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-ui hover:border-brand/50 hover:text-brand-strong"
        >
          {t("advisorV2.card.view", locale)} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-2.5 text-xs">
        {a.startingPriceAed != null ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{t("advisorV2.card.from", locale)}</dt>
            <dd className="num font-semibold" title="Starting price">{formatAEDPrecise(a.startingPriceAed)}</dd>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{t("advisorV2.card.price", locale)}</dt>
            <dd><UnavailableValue /></dd>
          </div>
        )}
        {handover ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="inline-flex items-center gap-1 text-muted-foreground"><CalendarClock className="h-3 w-3" aria-hidden />{t("advisorV2.card.handover", locale)}</dt>
            <dd>{handover}</dd>
          </div>
        ) : null}
        {a.completionPercent != null ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{t("advisorV2.card.completion", locale)}</dt>
            <dd className="num">{a.completionPercent}%</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function CommunityAttachmentCard({ a, locale }: { a: CommunityCardAttachment; locale: Locale }) {
  return (
    <article className="rounded-lg border border-border/60 bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
            <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            {a.name}
          </h4>
          {a.summary ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{a.summary}</p> : null}
        </div>
        <Link
          to={a.url}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-ui hover:border-brand/50 hover:text-brand-strong"
        >
          {t("advisorV2.card.view", locale)} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-2.5 text-xs">
        {a.avgPricePerSqftAed != null ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{t("advisorV2.card.avgPerSqft", locale)}</dt>
            <dd className="num font-semibold">{formatAEDPrecise(a.avgPricePerSqftAed)}/sqft</dd>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{t("advisorV2.card.avgPerSqft", locale)}</dt>
            <dd><UnavailableValue /></dd>
          </div>
        )}
      </div>
    </article>
  );
}

const TIMELINE_SEGMENT_COLORS = [
  "bg-brand",
  "bg-brand/70",
  "bg-brand/50",
  "bg-brand/35",
  "bg-brand/25",
  "bg-brand/15",
];

function PaymentTimelineViz({ a, locale }: { a: PaymentTimelineAttachment; locale: Locale }) {
  return (
    <article aria-label={t("advisorV2.attach.paymentPlan", locale)} className="rounded-lg border border-border/60 bg-card p-3.5">
      <h4 className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-brand" aria-hidden />
          {t("advisorV2.attach.paymentPlan", locale)}
        </span>
        <span className="num normal-case text-foreground/80" title={t("advisorV2.attach.onPurchase", locale).replace("{p}", formatAEDPrecise(a.purchasePriceAed))}>
          {t("advisorV2.attach.onPurchase", locale).replace("{p}", formatAEDPrecise(a.purchasePriceAed))}
        </span>
      </h4>

      {!a.valid && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("advisorV2.attach.planInvalid", locale)} {a.validationErrors.slice(0, 2).join(" ")}
        </p>
      )}

      {/* Stacked percent bar (deterministic widths from engine output) */}
      <div className="mt-2.5 flex h-6 w-full overflow-hidden rounded-md border border-border/60" role="img" aria-label={t("advisorV2.attach.timelineSr", locale).replace("{n}", String(a.stages.length))}>
        {a.stages.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            className={cn("flex min-w-[2%] items-center justify-center overflow-hidden", TIMELINE_SEGMENT_COLORS[i % TIMELINE_SEGMENT_COLORS.length])}
            style={{ width: `${Math.max(s.percent, 1)}%` }}
            title={`${s.name}: ${s.percent}%`}
          >
            {s.percent >= 12 && <span className="num px-0.5 text-[10px] font-semibold text-primary-foreground">{s.percent}%</span>}
          </div>
        ))}
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {a.stages.map((s, i) => (
          <li key={`${s.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/40 pb-1.5 text-xs last:border-0 last:pb-0">
            <span className="min-w-0 flex-1 truncate font-medium" title={s.name}>{s.name}</span>
            <span className="num text-muted-foreground">{s.dueLabel}</span>
            <span className="num w-14 text-right font-semibold" title={`${formatAEDPrecise(s.amount)} — stage amount`}>{formatAEDPrecise(s.amount)}</span>
            <span className="num w-14 text-right text-muted-foreground" title={`${s.percent}% of purchase price`}>{s.percent}%</span>
          </li>
        ))}
      </ul>
      <p className="num mt-2 flex justify-between border-t border-border/60 pt-2 text-xs font-semibold">
        <span>{t("advisorV2.attach.total", locale)}</span>
        <span title={`${a.totalPercent}% of purchase price`}>
          {formatAEDPrecise(a.stages.reduce((sum, s) => sum + s.amount, 0))} · {a.totalPercent}%
        </span>
      </p>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {t("advisorV2.attach.engine", locale).replace("{v}", a.engineVersion)} · {t("advisorV2.attach.deterministic", locale)}
      </p>
    </article>
  );
}

const SCENARIO_TONE: Record<"downside" | "base" | "upside", string> = {
  downside: "border-warning/30 bg-warning/5",
  base: "border-border/60 bg-card",
  upside: "border-success/30 bg-success/5",
};

function ScenarioViz({ a, locale }: { a: ScenarioAttachment; locale: Locale }) {
  return (
    <article aria-label={t("advisorV2.attach.scenarios", locale)} className="rounded-lg border border-border/60 bg-card p-3.5">
      <h4 className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-brand" aria-hidden />
          {t("advisorV2.attach.scenarios", locale)}
        </span>
        <span className="flex flex-wrap items-center gap-2 normal-case">
          {a.irrPct != null && (
            <span className="num text-foreground/80" title="Internal rate of return">
              {t("advisorV2.attach.irr", locale)} <strong className="font-semibold">{formatPctPrecise(a.irrPct, 1)}</strong>
            </span>
          )}
          {a.breakEvenYear != null && (
            <span className="num text-foreground/80" title="First year cumulative net income covers cash invested">
              {t("advisorV2.attach.breakEven", locale)} <strong className="font-semibold">{t("advisorV2.attach.yearN", locale).replace("{n}", String(a.breakEvenYear))}</strong>
            </span>
          )}
        </span>
      </h4>
      <p className="num mt-1.5 text-[11px] text-muted-foreground" title="Model inputs">
        {t("advisorV2.attach.inputs", locale)
          .replace("{p}", formatAEDPrecise(a.purchasePriceAed))
          .replace("{r}", formatAEDPrecise(a.annualRentAed))
          .replace("{y}", String(a.horizonYears))}
      </p>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
        {a.scenarios.map((s) => (
          <div key={s.key} className={cn("rounded-md border p-2.5", SCENARIO_TONE[s.key])}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`advisorV2.attach.${s.key}`, locale)}
            </p>
            <p className="num mt-1 text-base font-semibold" title="Net yield (year 1)">
              {formatPctPrecise(s.netYieldPct, 2)}
            </p>
            <p className="num text-[11px] text-muted-foreground" title={`${formatAEDPrecise(s.totalReturnAed)} — total return over horizon`}>
              {formatAEDPrecise(s.totalReturnAed)} · {formatPctPrecise(s.totalReturnPct, 1)}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <DataStateBadge state="MODELED" />
        {t("advisorV2.attach.engine", locale).replace("{v}", a.engineVersion)} · {t("advisorV2.attach.projectionNote", locale)}
      </p>
    </article>
  );
}

function ComparisonTable({ a, locale }: { a: ComparisonTableAttachment; locale: Locale }) {
  return (
    <article aria-label={a.title} className="rounded-lg border border-border/60 bg-card p-3.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Landmark className="h-3.5 w-3.5 text-brand" aria-hidden />
        {a.title}
      </h4>
      <div className="mt-2.5 overflow-x-safe">
        <table className="w-full min-w-[420px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/70">
              <th scope="col" className="py-1.5 pe-3 text-start font-medium text-muted-foreground">{t("advisorV2.attach.metric", locale)}</th>
              {a.columns.map((c, i) => (
                <th key={`${c}-${i}`} scope="col" className="py-1.5 px-2 text-start font-semibold">
                  {a.urls[i] ? (
                    <Link to={a.urls[i]!} className="transition-ui hover:text-brand-strong">{c}</Link>
                  ) : (
                    c
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.rows.map((row) => (
              <tr key={row.metric} className="border-b border-border/40 last:border-0">
                <th scope="row" className="py-1.5 pe-3 text-start font-medium text-muted-foreground">{row.metric}</th>
                {row.cells.map((cell, i) => (
                  <td key={i} className={cn("num py-1.5 px-2", cell === "Not provided" && "not-italic")}>
                    {cell === "Not provided" ? <UnavailableValue /> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function SourceAttachmentCard({ a, locale }: { a: SourceCardAttachment; locale: Locale }) {
  const fresh = freshnessLabel(a.verifiedAt ?? a.source.asOf);
  return (
    <article className="rounded-lg border border-border/60 bg-card p-3">
      <h4 className="flex items-start justify-between gap-2 text-xs font-semibold leading-snug">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
          {a.url ? (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate underline decoration-border underline-offset-2 transition-ui hover:text-brand-strong">
              {a.title}
            </a>
          ) : (
            <span className="truncate">{a.title}</span>
          )}
          {a.url && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />}
        </span>
      </h4>
      {a.excerpt ? <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{a.excerpt}…</p> : null}
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <DataStateBadge state={a.source.state} />
        {fresh ? <span>{t("advisorV2.attach.verified", locale).replace("{d}", fresh)}</span> : null}
        {a.trustTier ? <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">{a.trustTier}</span> : null}
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * List + sources line (§22.5)
 * ------------------------------------------------------------------ */

export function AttachmentList({ attachments, locale }: { attachments: AdvisorAttachment[]; locale: Locale }) {
  if (!attachments?.length) return null;
  const propertyCards = attachments.filter((a) => a.kind === "property_card") as PropertyCardAttachment[];
  const others = attachments.filter((a) => a.kind !== "property_card");
  return (
    <div className="mt-3 space-y-2.5">
      {propertyCards.length > 0 && (
        <section aria-label={t("advisorV2.attach.matches", locale)} className="rounded-xl border border-border/70 bg-sand/30 p-3">
          <p className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-brand" aria-hidden />
              {t("advisorV2.attach.matches", locale)} · {propertyCards.length}
            </span>
            <span className="text-[10px] font-normal normal-case">{t("advisorV2.attach.grounded", locale)}</span>
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {propertyCards.map((a) => (
              <li key={a.slug} className="min-w-0">
                <PropertyAttachmentCard a={a} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.map((a, i) => {
        switch (a.kind) {
          case "project_card":
            return <ProjectAttachmentCard key={`proj-${a.slug}-${i}`} a={a} locale={locale} />;
          case "community_card":
            return <CommunityAttachmentCard key={`comm-${a.slug}-${i}`} a={a} locale={locale} />;
          case "comparison_table":
            return <ComparisonTable key={`cmp-${i}`} a={a} locale={locale} />;
          case "payment_timeline":
            return <PaymentTimelineViz key={`pp-${i}`} a={a} locale={locale} />;
          case "scenario":
            return <ScenarioViz key={`sc-${i}`} a={a} locale={locale} />;
          case "source_card":
            return <SourceAttachmentCard key={`src-${a.title}-${i}`} a={a} locale={locale} />;
          default:
            return null;
        }
      })}
      <AttachmentSources attachments={attachments} locale={locale} />
    </div>
  );
}

/** §22.5 — "Sources · freshness" line aggregated from attachment metadata. */
export function AttachmentSources({ attachments, locale }: { attachments: AdvisorAttachment[]; locale: Locale }) {
  const withSources = attachments.filter((a) => a.source);
  if (!withSources.length) return null;
  // Aggregate: one entry per distinct state+asOf pair (badge + date), compact row.
  const seen = new Map<string, { state: AttachmentSource["state"]; asOf: string | null; note?: string | null }>();
  for (const a of withSources) {
    const asOf = a.source.asOf ?? null;
    const key = `${a.source.state}|${asOf ?? ""}`;
    if (!seen.has(key)) seen.set(key, { state: a.source.state, asOf, note: a.source.note ?? null });
  }
  const entries = [...seen.values()].slice(0, 4);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">{t("advisorV2.attach.sources", locale)}</span>
      {entries.map((e, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <DataStateBadge state={e.state} />
          {e.asOf ? <span title={new Date(e.asOf).toISOString()}>{t("advisorV2.attach.asOf", locale).replace("{d}", freshnessLabel(e.asOf) ?? "")}</span> : null}
        </span>
      ))}
    </p>
  );
}

"use client";

/**
 * Payment plan timeline (U07 — V2 §15.1).
 *
 * Interactive visualization of a developer payment plan built on the scenario
 * engine's importFromProject / normalizePaymentPlan:
 *  - stages are grouped into the four §15.1 phases (booking → construction
 *    milestones → handover → post-handover);
 *  - every stage shows percentage + amount (formatAEDPrecise, full value in
 *    tooltip) + due label + cumulative paid;
 *  - the segmented bar is proportional to each stage's share of the price;
 *  - a handover marker splits pre-/post-handover visually;
 *  - plan verification status rides a ProvenanceBadge and a "sums to 100%"
 *    engine validation line (validate100) — a plan that doesn't total 100%
 *    says so loudly instead of pretending;
 *  - amounts are MODELED on the reference price (lowest listed unit price or
 *    the developer's starting price); the reference is editable;
 *  - mobile collapses to a vertical timeline (375px-safe).
 */

import * as React from "react";
import { importFromProject, type PaymentPlanTimelineEntry } from "@/lib/scenario-engine";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { formatNumber } from "@/lib/money";
import { ProvenanceBadge } from "@/components/common";
import { DataStateBadge } from "@/components/common/data-state";
import { t, type Locale } from "@/lib/i18n";
import { planStructure } from "@/components/entity/entity-shared";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, TriangleAlert, Flag, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Phase = "booking" | "construction" | "handover" | "post";

interface PlanInstallment {
  sequence: number;
  label: string;
  percent: number;
  dueOffsetMonths: number | null;
}

function phaseOf(inst: PlanInstallment): Phase {
  const label = (inst.label ?? "").toLowerCase();
  if (/post[- ]?handover/.test(label) || (inst.dueOffsetMonths !== null && inst.dueOffsetMonths > 36)) return "post";
  if (inst.dueOffsetMonths === 0 && /book/.test(label)) return "booking";
  if (/handover/.test(label)) return "handover";
  if (inst.dueOffsetMonths === 0) return "booking";
  return "construction";
}

const PHASE_STYLE: Record<Phase, { bar: string; dot: string }> = {
  booking: { bar: "bg-brand", dot: "bg-brand" },
  construction: { bar: "bg-brand/55", dot: "bg-brand/70" },
  handover: { bar: "bg-success", dot: "bg-success" },
  post: { bar: "bg-muted-foreground/45", dot: "bg-muted-foreground/60" },
};

export function PaymentPlanTimeline({
  plan,
  referencePrice,
  currency = "AED",
  locale = "en",
}: {
  plan: {
    id: string;
    name: string;
    totalPercent: number;
    postHandover: boolean;
    verificationStatus: string;
    isDefault: boolean;
    installments: PlanInstallment[];
  };
  /** Reference price in MAJOR units (AED) for modeled amounts. */
  referencePrice: number;
  currency?: string;
  locale?: Locale;
}) {
  const [priceInput, setPriceInput] = React.useState<string>(String(Math.round(referencePrice)));
  const parsedPrice = Number(priceInput.replace(/[^0-9.]/g, ""));
  const effectivePrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : referencePrice;

  const result = React.useMemo(() => importFromProject(plan.installments, effectivePrice), [plan.installments, effectivePrice]);
  const stages: (PaymentPlanTimelineEntry & { phase: Phase })[] = React.useMemo(
    () =>
      result.stages.map((s) => {
        const inst = plan.installments.find((i) => i.label === s.name) ?? null;
        return { ...s, phase: inst ? phaseOf(inst) : "construction" };
      }),
    [result.stages, plan.installments]
  );
  const structure = React.useMemo(() => planStructure(plan.installments), [plan.installments]);

  const verified = plan.verificationStatus === "VERIFIED";
  const sumsTo100 = result.validation.valid;

  return (
    <div className="rounded-xl border border-brand/25 bg-brand-faint/40 p-5">
      {/* Plan header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">
            {plan.name}
            {plan.isDefault && <span className="ml-2 text-xs font-normal text-muted-foreground">({t("project.plan.standard", locale)})</span>}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="num">
              {t("project.plan.structure", locale)}:{" "}
              <span className="font-medium text-foreground/80">
                {structure.booking}/{structure.duringConstruction}/{structure.onHandover}/{structure.postHandover}
              </span>{" "}
              {t("project.plan.structureLegend", locale)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProvenanceBadge
            chip={{
              sourceType: plan.verificationStatus === "VERIFIED" ? "VERIFIED" : plan.verificationStatus === "PUBLISHED" ? "PUBLISHED" : "UNVERIFIED",
              sourceName: t("project.plan.source", locale),
            }}
          />
          {plan.postHandover && <Badge variant="outline">{t("project.plan.postHandover", locale)}</Badge>}
        </div>
      </div>

      {/* Reference price + engine validation line */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card p-3">
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("project.plan.amountsBasedOn", locale)}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase">{currency}</span>
            <input
              type="text"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              aria-label={t("project.plan.referencePriceAria", locale)}
              className="num w-36 rounded-md border border-border bg-background px-2.5 py-1.5 text-base font-medium tabular-nums outline-none transition-ui focus:border-brand focus:ring-2 focus:ring-brand/20 sm:text-sm"
            />
          </span>
          <span className="text-[11px] text-muted-foreground/80">
            {t("project.plan.referenceHint", locale)} · <DataStateBadge state="MODELED" />
          </span>
        </label>
        {sumsTo100 ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("project.plan.sumsOk", locale).replace("{n}", formatPctPrecise(result.validation.totalPercent, 0))}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            {t("project.plan.sumsBad", locale).replace("{n}", formatPctPrecise(result.validation.totalPercent, 1))}
          </p>
        )}
      </div>

      {/* Segmented proportional bar (desktop horizontal track) */}
      <div className="mt-6 hidden sm:block" aria-hidden>
        <div className="relative">
          {/* Phase legend */}
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {(["booking", "construction", "handover", "post"] as Phase[]).map((p) => {
              const share = { booking: structure.booking, construction: structure.duringConstruction, handover: structure.onHandover, post: structure.postHandover }[p];
              if (share <= 0) return null;
              return (
                <span key={p} className="flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-sm", PHASE_STYLE[p].bar)} />
                  {t(`project.plan.phase.${p}`, locale)} · {Math.round(share)}%
                </span>
              );
            })}
          </div>
          {/* Track */}
          <div className="flex h-4 w-full gap-px overflow-hidden rounded-full">
            {stages.map((s, i) => (
              <div
                key={i}
                className={cn("h-full", PHASE_STYLE[s.phase].bar, s.phase === "post" && "opacity-70")}
                style={{ width: `${s.percent}%` }}
                title={`${s.name} — ${formatPctPrecise(s.percent, 0)} · ${formatAEDPrecise(s.amount)}`}
              />
            ))}
          </div>
          {/* Handover marker */}
          {(() => {
            const handoverIdx = stages.findIndex((s) => s.phase === "handover");
            if (handoverIdx === -1) return null;
            const before = stages.slice(0, handoverIdx).reduce((s, x) => s + x.percent, 0);
            return (
              <div className="absolute -top-5 -bottom-1 w-px border-l-2 border-dashed border-success/70" style={{ left: `${before}%` }}>
                <Flag className="absolute -top-4 -left-2 h-3.5 w-3.5 text-success" aria-hidden />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Stage cards — horizontal on ≥sm, vertical timeline on mobile */}
      <ol className="mt-5 space-y-0">
        {stages.map((s, i) => {
          const last = i === stages.length - 1;
          return (
            <li key={i} className="relative">
              <div
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg py-2.5 sm:grid-cols-[28px_1fr_auto] sm:items-center sm:gap-4 sm:px-2",
                  i % 2 === 0 ? "sm:bg-transparent" : "sm:bg-card/60",
                  "transition-colors hover:bg-card"
                )}
              >
                {/* Timeline node */}
                <div className="relative flex justify-center sm:justify-start">
                  <span className={cn("z-10 mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-background", PHASE_STYLE[s.phase].dot)} aria-hidden />
                  {!last && <span className="absolute left-1/2 top-5 h-[calc(100%+4px)] w-px -translate-x-1/2 bg-border sm:left-[7px] sm:top-4 sm:h-[calc(100%+8px)]" aria-hidden />}
                </div>
                {/* Stage info */}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <span className="num rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {formatPctPrecise(s.percent, 0)}
                    </span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      s.phase === "handover" ? "bg-success/10 text-success" : s.phase === "post" ? "bg-secondary text-muted-foreground" : "bg-brand-soft text-brand-strong"
                    )}>
                      {t(`project.plan.phase.${s.phase}`, locale)}
                    </span>
                  </p>
                  <p className="num mt-0.5 text-xs text-muted-foreground">{s.dueLabel}</p>
                </div>
                {/* Amounts — mobile: second row, aligned under the stage info
                    (col 1 stays the narrow 14px timeline-node track; the old
                    auto-placement put this row into col 1, stretching the node
                    track to the amounts' max-content and overflowing ≤430px) */}
                <div className="col-start-2 sm:col-start-auto sm:text-right">
                  <p className="num text-sm font-semibold" title={fullValueTooltip(s.amount)}>
                    {formatAEDPrecise(s.amount)}
                  </p>
                  <p className="num text-[11px] text-muted-foreground">
                    {t("project.plan.cumulative", locale)}: {formatPctPrecise(s.cumulativePercent, 0)} · {formatAEDPrecise(s.cumulative)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Total + notes */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3">
        <p className="num text-sm">
          <span className="text-muted-foreground">{t("project.plan.total", locale)}: </span>
          <span className="font-semibold" title={fullValueTooltip(result.totalAmount)}>
            {formatAEDPrecise(result.totalAmount)}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({t("project.plan.stagesCount", locale).replace("{n}", formatNumber(stages.length))})
          </span>
        </p>
        <p className="num text-xs text-muted-foreground">
          {t("project.plan.engineNote", locale)}
        </p>
      </div>
      {!verified && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("project.plan.verificationNote", locale)}
        </p>
      )}
    </div>
  );
}

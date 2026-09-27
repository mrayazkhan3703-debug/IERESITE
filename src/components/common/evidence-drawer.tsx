"use client";

/**
 * Evidence drawer (V3-G §28) — ONE reusable affordance for interrogating any
 * important market/investment number on the platform.
 *
 * Mobile (<768px): bottom sheet. Desktop (≥768px): side drawer from the right.
 * (shadcn Sheet side switched by the useIsMobile breakpoint hook.)
 *
 * Fields (all optional — missing ones render the honest UnavailableValue,
 * never a fabricated provenance field): value, state badge (DataStateBadge
 * machinery from src/lib/data-state.ts), source, publisher, effective date,
 * retrieval date, methodology, transformation, sample size, caveats.
 *
 * Opens fire the `evidence_open` analytics event with the surface id.
 */

import * as React from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DataStateBadge, UnavailableValue } from "@/components/common/data-state";
import { Button } from "@/components/ui/button";
import { BadgeCheck } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { events } from "@/lib/analytics-tracker";
import { intlLocale, t, type Locale } from "@/lib/i18n";
import { formatDate, formatNumber } from "@/lib/money";
import type { MetricState } from "@/lib/data-state";
import { cn } from "@/lib/utils";

export interface EvidenceRecord {
  /** The figure itself, already formatted for display. */
  value?: React.ReactNode;
  /** Presentation state from the data-state machine (§37). */
  state?: MetricState | null;
  /** Source name / dataset the figure came from. */
  source?: string | null;
  /** Publisher, e.g. "DLD" / "Dubai Statistics Center". */
  publisher?: string | null;
  /** When the underlying data was effective (period end). */
  effectiveDate?: string | Date | null;
  /** When the figure was retrieved from the source. */
  retrievalDate?: string | Date | null;
  /** How the figure is computed / what it covers. */
  methodology?: string | null;
  /** Client-side derivation note (medians, joins, filters). */
  transformation?: string | null;
  /** Sample size behind the figure (records/contracts). */
  sampleSize?: number | null;
  /** Honest caveats — exclusions, scope limits, staleness. */
  caveats?: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-foreground/90">{children}</dd>
    </div>
  );
}

/**
 * The evidence drawer. Controlled via `open`/`onOpenChange`, or uncontrolled
 * via `trigger` (rendered as the SheetTrigger child).
 */
export function EvidenceDrawer({
  title,
  description,
  evidence,
  surface,
  trigger,
  open,
  onOpenChange,
  triggerLabel,
  triggerClassName,
  locale = "en",
}: {
  /** Card/figure title shown in the drawer header. */
  title: string;
  /** Optional subtitle for the drawer header. */
  description?: string;
  evidence: EvidenceRecord;
  /** Analytics surface id for evidence_open (e.g. "market_kpi"). */
  surface: string;
  /** Uncontrolled mode: trigger element (button) rendered inside SheetTrigger asChild. */
  trigger?: React.ReactElement;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** Default trigger label when no custom trigger is passed. */
  triggerLabel?: string;
  triggerClassName?: string;
  locale?: Locale;
}) {
  const isMobile = useIsMobile();
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const l = intlLocale(locale);
  const e = evidence;

  const handleOpenChange = (o: boolean) => {
    if (o) events.evidenceOpen(surface);
    setOpen(o);
  };

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-11 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:h-7",
        triggerClassName
      )}
      aria-label={t("evidence.open", locale).replace("{title}", title)}
    >
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {triggerLabel ?? t("evidence.trigger", locale)}
    </Button>
  );

  const dateOrUnavailable = (d: string | Date | null | undefined) =>
    d ? formatDate(d, l, { year: "numeric", month: "short", day: "numeric" }) : <UnavailableValue />;

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger ?? defaultTrigger}</SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        /* §17 — fast drawer slide inside the 150–220ms band (matching the
           site-header nav sheet contract), not the 500ms shadcn default. */
        className="max-h-[85vh] overflow-y-auto data-[state=open]:duration-200 data-[state=closed]:duration-150 sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2 text-left">
            <BadgeCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {title}
          </SheetTitle>
          <SheetDescription className="text-left">
            {description ?? t("evidence.drawerDescription", locale)}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {/* The figure + its presentation state */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-sand/40 p-3.5">
            <div className="min-w-0">
              <p className="type-label text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("evidence.value", locale)}
              </p>
              <p className="num mt-0.5 font-display text-xl font-semibold text-ink">
                {e.value ?? <UnavailableValue />}
              </p>
            </div>
            {e.state ? (
              <DataStateBadge state={e.state} />
            ) : (
              <span className="text-xs text-muted-foreground">{t("evidence.stateUnknown", locale)}</span>
            )}
          </div>

          <dl className="mt-4 space-y-3">
            <Field label={t("home.evidence.source", locale)}>
              {e.source ?? <UnavailableValue />}
            </Field>
            <Field label={t("home.evidence.publisher", locale)}>
              {e.publisher ?? <UnavailableValue />}
            </Field>
            <Field label={t("home.evidence.effectiveDate", locale)}>{dateOrUnavailable(e.effectiveDate)}</Field>
            <Field label={t("home.evidence.retrievalDate", locale)}>{dateOrUnavailable(e.retrievalDate)}</Field>
            {e.sampleSize !== undefined && e.sampleSize !== null && (
              <Field label={t("evidence.sampleSize", locale)}>
                <span className="num">{formatNumber(e.sampleSize)}</span>
              </Field>
            )}
            {e.methodology !== undefined && (
              <FieldBlock label={t("home.evidence.methodology", locale)}>
                {e.methodology ?? <UnavailableValue />}
              </FieldBlock>
            )}
            {e.transformation !== undefined && (
              <FieldBlock label={t("home.evidence.transformation", locale)}>
                {e.transformation ?? <UnavailableValue />}
              </FieldBlock>
            )}
            {e.caveats && (
              <FieldBlock label={t("evidence.caveats", locale)}>
                <span className="block rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed text-foreground/85">
                  {e.caveats}
                </span>
              </FieldBlock>
            )}
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            {t("evidence.footer", locale)}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

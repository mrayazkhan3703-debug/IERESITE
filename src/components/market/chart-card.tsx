"use client";

/**
 * Shared chart card wrapper (U10 §19) — consistent header (title, description,
 * state badge, per-chart Source drawer action) around every new market chart.
 * The sr-only summary keeps key figures accessible to screen readers (§52 a11y).
 * V3-F §20: optional askAiQuery renders a contextual "Explain this trend" link
 * into the AI advisor (prefilled ?q= — never auto-sent).
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Sparkles } from "lucide-react";
import { ProvenanceBadge } from "@/components/common";
import { t, localeOf } from "@/lib/i18n";
import { useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  description,
  isIllustrative,
  action,
  askAiQuery,
  srSummary,
  children,
  className,
}: {
  title: string;
  description?: string;
  isIllustrative?: boolean;
  action?: React.ReactNode;
  /** §20 contextual entry — prefilled advisor query for this chart's trend. */
  askAiQuery?: string;
  /** Text alternative for the visualization (a11y — charts are role="img"). */
  srSummary?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {/* §40: actions wrap on phones (ask-AI link + Source + state badge must
            never force the card wider than its grid track). */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {askAiQuery && (
            <Link
              to="/advisor"
              query={{ q: askAiQuery }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft/50 px-3 py-1.5 text-xs font-medium text-brand-strong transition-ui hover:border-brand/50 hover:bg-brand-soft sm:min-h-0"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("market.chart.askAi", locale)}
            </Link>
          )}
          {action}
          {isIllustrative !== undefined && <ProvenanceBadge chip={{ sourceType: "DEMO", isIllustrative }} />}
        </div>
      </div>
      <div className="mt-4">{children}</div>
      {srSummary && <p className="sr-only">{srSummary}</p>}
    </div>
  );
}

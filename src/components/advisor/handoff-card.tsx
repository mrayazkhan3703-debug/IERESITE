"use client";

/**
 * Human-handoff confirmation card (V2 §22.6).
 *
 * Rendered on the assistant message that triggered the handoff. Lists the
 * context ACTUALLY transferred (requirements, shortlisted inventory, scenario
 * assumptions — from the server-built handoffDetail payload), the reference
 * number, and the two continuation paths: booking a consultation or leaving
 * contact details. The user never has to repeat their requirements.
 */
import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n";
import { formatAEDPrecise } from "@/lib/format-precise";
import { Phone, ArrowRight, CheckCircle2, ClipboardList, Layers, Calculator } from "lucide-react";

export interface HandoffDetail {
  reference: string;
  note: string | null;
  requirements: string[];
  shortlist: { title: string; community: string; priceAed: number | null; url: string }[];
  assumptions: { tool: string; summary: string }[];
  transferredAt: string;
}

export function HandoffConfirmationCard({
  detail,
  locale,
  onLeaveDetails,
}: {
  detail: HandoffDetail;
  locale: Locale;
  onLeaveDetails: () => void;
}) {
  return (
    <aside
      aria-label={t("advisorV2.handoff.title", locale)}
      className="mt-3 rounded-xl border border-brand/40 bg-brand-faint p-4"
    >
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-sm font-semibold leading-snug">
            {t("advisorV2.handoff.shared", locale)}
          </h4>
          <p className="num mt-0.5 text-xs text-muted-foreground">
            {t("advisorV2.handoff.reference", locale).replace("{ref}", detail.reference)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("advisorV2.handoff.noRepeat", locale)}</p>

      <div className="mt-3 space-y-3">
        {detail.requirements.length > 0 && (
          <section aria-label={t("advisorV2.handoff.requirements", locale)}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="h-3 w-3" aria-hidden />
              {t("advisorV2.handoff.requirements", locale)}
            </p>
            <ul className="mt-1.5 space-y-1">
              {detail.requirements.slice(-3).map((r, i) => (
                <li key={i} className="line-clamp-2 rounded-md bg-card/70 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/85">
                  “{r}”
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.shortlist.length > 0 && (
          <section aria-label={t("advisorV2.handoff.shortlist", locale)}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3 w-3" aria-hidden />
              {t("advisorV2.handoff.shortlist", locale)} · {detail.shortlist.length}
            </p>
            <ul className="mt-1.5 space-y-1">
              {detail.shortlist.slice(0, 4).map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-card/70 px-2.5 py-1.5 text-xs">
                  {s.url ? (
                    <Link to={s.url} className="min-w-0 truncate font-medium underline decoration-transparent underline-offset-2 transition-ui hover:text-brand-strong" title={s.title}>
                      {s.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate font-medium" title={s.title}>{s.title}</span>
                  )}
                  {s.priceAed != null && <span className="num shrink-0 text-muted-foreground">{formatAEDPrecise(s.priceAed)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.assumptions.length > 0 && (
          <section aria-label={t("advisorV2.handoff.assumptions", locale)}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Calculator className="h-3 w-3" aria-hidden />
              {t("advisorV2.handoff.assumptions", locale)}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {detail.assumptions.map((a, i) => (
                <li key={i} className="num rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[10px] text-muted-foreground" title={a.summary}>
                  <span className="font-mono text-brand-strong">{a.tool}</span> · {a.summary.length > 60 ? `${a.summary.slice(0, 59)}…` : a.summary}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/consultation">
            <Phone className="h-4 w-4" aria-hidden />
            {t("advisorV2.handoff.book", locale)}
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={onLeaveDetails}>
          {t("advisorV2.handoff.leaveDetails", locale)}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </aside>
  );
}

"use client";

/**
 * Portfolio AI handoff (V2 §25.7, U15): a CTA that opens the AI advisor with a
 * portfolio context summary. The advisor explains with deterministic tools —
 * it never makes autonomous investment decisions (red line preserved).
 */
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { formatAEDPrecise, formatPctPrecise } from "@/lib/format-precise";
import { t, localeOf } from "@/lib/i18n";
import { Sparkles, ShieldAlert } from "lucide-react";
import type { PortfolioData } from "./portfolio-types";

export function PortfolioAi({ data }: { data: PortfolioData }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const major = (m: string | null) => (m === null ? null : Number(m) / 100);

  // Compact context embedded in the prefilled advisor message (the advisor's
  // ?q prefill path — the user sees and controls exactly what is shared; the
  // AI receives it as conversation context, then explains with tools only).
  const question = "Explain my portfolio: modeled yields, upcoming payment obligations and which holdings have the lowest modeled net yield.";
  const summary =
    data.totals.holdingsCount === 0
      ? "My portfolio is empty."
      : [
          `My portfolio (MODELED figures): ${data.totals.holdingsCount} holding(s)`,
          `value ${formatAEDPrecise(major(data.totals.valueMinor) ?? 0)}`,
          `cost ${formatAEDPrecise(major(data.totals.acquisitionCostMinor) ?? 0)}`,
          data.totals.equityMinor !== null ? `equity ${formatAEDPrecise(major(data.totals.equityMinor) ?? 0)}` : null,
          data.totals.annualRentMinor !== null ? `rent ${formatAEDPrecise(major(data.totals.annualRentMinor) ?? 0)}/yr` : null,
          data.totals.grossYieldPct !== null ? `gross ${formatPctPrecise(data.totals.grossYieldPct)}` : null,
          data.totals.netYieldPct !== null ? `net ${formatPctPrecise(data.totals.netYieldPct)}` : null,
          ...data.holdings.slice(0, 4).map(
            (h) =>
              `${h.label}: value ${formatAEDPrecise(Number(h.valuation.minor) / 100)}, net cash ${formatAEDPrecise(h.cashflow.net)}/yr${
                h.paymentSchedule.length ? `, ${h.paymentSchedule.length} upcoming payment(s)` : ""
              }`
          ),
        ]
          .filter(Boolean)
          .join("; ")
          .slice(0, 850);
  const prefill = `${question} ${summary}`;

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-brand" aria-hidden />
            {t_("portfolio.ai.title")}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t_("portfolio.ai.note")}</p>
          <p className="mt-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Context to be shared: </span>
            {summary}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button asChild className="gap-1.5 rounded-full">
            <Link to="/advisor" query={{ q: prefill }}>
              <Sparkles className="h-4 w-4" aria-hidden /> {t_("portfolio.ai.cta")}
            </Link>
          </Button>
          <p className="flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-brand-strong" aria-hidden />
            Explanations only — the AI never picks, buys or sells for you. The context above is prefilled as your
            first message so you see exactly what is shared.
          </p>
        </div>
      </div>
    </div>
  );
}

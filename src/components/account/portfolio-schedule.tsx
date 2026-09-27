"use client";

/**
 * Off-plan tracker (V2 §25.4 + §25.5, U15): upcoming payment installments
 * derived from the project's payment plan (modeled — stated, not a statement
 * of account) and the construction tracker (completion / handover / source
 * date, only when the project actually carries sourced values).
 */
import { DataStateBadge } from "@/components/common";
import { formatAEDPrecise } from "@/lib/format-precise";
import { formatDate } from "@/lib/money";
import { t, localeOf } from "@/lib/i18n";
import { CalendarClock, HardHat, Info } from "lucide-react";
import type { PortfolioData, PortfolioHolding } from "./portfolio-types";

export function PortfolioSchedule({ data }: { data: PortfolioData }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const rows = data.holdings.flatMap((h) => h.paymentSchedule.map((p) => ({ h, p })));

  return (
    <div>
      <h2 className="font-display text-lg font-semibold">{t_("portfolio.schedule.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t_("portfolio.schedule.sub")}</p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-sand/30 px-5 py-8 text-center text-sm text-muted-foreground">
          {t_("portfolio.schedule.empty")}
        </p>
      ) : (
        <div className="mt-4 overflow-x-safe rounded-xl border border-border/70">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Upcoming payment installments</caption>
            <thead>
              <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 font-medium">Holding / project</th>
                <th scope="col" className="p-3 font-medium">{t_("portfolio.schedule.stage")}</th>
                <th scope="col" className="num p-3 text-right font-medium">%</th>
                <th scope="col" className="num p-3 text-right font-medium">{t_("portfolio.schedule.amount")}</th>
                <th scope="col" className="p-3 font-medium">{t_("portfolio.schedule.due")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, p }, i) => (
                <tr key={`${h.id}-${i}`} className="border-b border-border/40 last:border-0">
                  <th scope="row" className="max-w-[180px] truncate p-3 text-left text-xs font-medium text-muted-foreground" title={`${h.label}${h.projectSlug ? ` · ${h.projectSlug}` : ""}`}>
                    {h.label}
                  </th>
                  <td className="p-3 text-sm">{p.stage}</td>
                  <td className="num p-3 text-right text-muted-foreground">{p.percent.toFixed(0)}%</td>
                  <td className="num p-3 text-right font-semibold" title={String(Number(p.amountMinor) / 100)}>
                    {formatAEDPrecise(Number(p.amountMinor) / 100)}
                  </td>
                  <td className="num p-3 text-sm">
                    {p.dueDate ? (
                      <span className="flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        {formatDate(p.dueDate)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground" title="Milestone-ordered stage — no calendar date derivable">{p.dueLabel}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Amounts are purchase-price × plan percent; dates are purchase date + the plan's month offsets. Confirm actual
        statements with the developer — this is a modeled schedule.
      </p>
    </div>
  );
}

export function PortfolioConstruction({ data }: { data: PortfolioData }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string) => t(key, locale);
  const tracked = data.holdings.filter((h) => h.construction !== null) as (PortfolioHolding & { construction: NonNullable<PortfolioHolding["construction"]> })[];
  const withData = tracked.filter((h) => h.construction.completionPercent !== null || h.construction.handoverDate !== null);

  return (
    <div>
      <h2 className="font-display text-lg font-semibold">{t_("portfolio.construction.title")}</h2>
      {withData.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t_("portfolio.construction.notTracked")}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {withData.map((h) => (
            <div key={h.id} className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-semibold">{h.label}</h3>
                  {h.projectSlug && <p className="text-xs text-muted-foreground">{h.projectSlug}</p>}
                </div>
                <DataStateBadge state="MODELED" />
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                {h.construction.completionPercent !== null && (
                  <div>
                    <dt className="flex items-center justify-between text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <HardHat className="h-3.5 w-3.5 text-brand" aria-hidden />
                        {t_("portfolio.construction.completion")}
                      </span>
                      <span className="num font-semibold text-foreground">{h.construction.completionPercent}%</span>
                    </dt>
                    <dd>
                      <div
                        className="mt-1 h-2 overflow-hidden rounded-full bg-sand"
                        role="progressbar"
                        aria-valuenow={h.construction.completionPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${h.label} completion`}
                      >
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, h.construction.completionPercent))}%` }} />
                      </div>
                    </dd>
                  </div>
                )}
                {h.construction.handoverDate !== null && (
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                      {t_("portfolio.construction.handover")}
                    </dt>
                    <dd className="num font-medium">{formatDate(h.construction.handoverDate)}</dd>
                  </div>
                )}
                {h.construction.sourceVerifiedAt !== null && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{t_("portfolio.construction.updated")}</dt>
                    <dd className="num font-medium">{formatDate(h.construction.sourceVerifiedAt)}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Cash-flow table (V2 §25.3, U15): per-holding annual lines computed by the
 * shared engine (rent / mortgage / service charge / maintenance / management /
 * net) with a totals row. Assumptions are printed verbatim from the API.
 */
import { formatAEDPrecise } from "@/lib/format-precise";
import { t, localeOf } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PortfolioData } from "./portfolio-types";

export function PortfolioCashflow({ data }: { data: PortfolioData }) {
  const locale = localeOf(typeof document !== "undefined" ? document.documentElement.lang : "en");
  const t_ = (key: string, vars?: Record<string, string>) => {
    let s = t(key, locale);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };

  const totals = data.holdings.reduce(
    (acc, h) => ({
      rent: acc.rent + h.cashflow.rent,
      mortgage: acc.mortgage + h.cashflow.mortgage,
      serviceCharge: acc.serviceCharge + h.cashflow.serviceCharge,
      maintenance: acc.maintenance + h.cashflow.maintenance,
      management: acc.management + h.cashflow.management,
      net: acc.net + h.cashflow.net,
    }),
    { rent: 0, mortgage: 0, serviceCharge: 0, maintenance: 0, management: 0, net: 0 }
  );

  if (data.holdings.length === 0) return null;

  const cols: { key: keyof typeof totals | "rent"; label: string }[] = [
    { key: "rent", label: t_("portfolio.cashflow.rent") },
    { key: "mortgage", label: t_("portfolio.cashflow.mortgage") },
    { key: "serviceCharge", label: t_("portfolio.cashflow.service") },
    { key: "maintenance", label: t_("portfolio.cashflow.maintenance") },
    { key: "management", label: t_("portfolio.cashflow.management") },
    { key: "net", label: t_("portfolio.cashflow.net") },
  ];

  return (
    <div>
      <h2 className="font-display text-lg font-semibold">{t_("portfolio.cashflow.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t_("portfolio.cashflow.sub")}</p>
      <div className="mt-4 overflow-x-safe rounded-xl border border-border/70">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Annual cash flow per holding</caption>
          <thead>
            <tr className="border-b border-border/70 bg-sand/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">Holding</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="num p-3 text-right font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.holdings.map((h) => (
              <tr key={h.id} className="border-b border-border/40 last:border-0">
                <th scope="row" className="max-w-[180px] truncate p-3 text-left text-xs font-medium text-muted-foreground" title={h.label}>
                  {h.label}
                </th>
                {cols.map((c) => {
                  const v = h.cashflow[c.key as keyof typeof h.cashflow];
                  return (
                    <td key={c.key} className="num p-3 text-right" title={String(v)}>
                      {formatAEDPrecise(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-border/70 bg-sand/30 font-semibold">
              <th scope="row" className="p-3 text-left text-xs uppercase tracking-wide text-muted-foreground">
                {t_("portfolio.cashflow.total")}
              </th>
              {cols.map((c) => {
                const v = totals[c.key as keyof typeof totals];
                return (
                  <td key={c.key} className={cn("num p-3 text-right")} title={String(v)}>
                    {formatAEDPrecise(v)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {t_("portfolio.cashflow.assumptions", {
          vacancy: String(data.assumptions.vacancyAllowancePct),
          maintenance: data.assumptions.maintenance,
          mgmt: String(data.assumptions.managementPct),
        })}
      </p>
    </div>
  );
}

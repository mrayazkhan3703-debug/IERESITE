"use client";

import * as React from "react";
import { useRoute } from "@/lib/router";
import { localeOf } from "@/lib/i18n";
import { calculatorCopy } from "@/lib/calculator-copy";
import { Link } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { CALCULATOR_TOOLS } from "@/lib/calculator-tools";
import { ArrowRight, CheckCircle2 } from "lucide-react";

/** Calculator hub — index of all investor tools with transparent methodology framing. */
export default function CalculatorsHubView() {
  const locale = localeOf(useRoute().locale);
  const c = React.useMemo(() => calculatorCopy(locale), [locale]);
  usePageMeta({
    title: c("Investor Calculators — Dubai Property Tools"),
    description:
      c("Five deterministic Dubai property calculators — ROI scenarios, rental yield, mortgage payments, off-plan payment plans and currency conversion — with assumptions separated from facts."),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: c("Investor calculators"),
      itemListElement: CALCULATOR_TOOLS.map((t, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c(t.title),
        url: `/calculators/${t.key}`,
      })),
    },
  });

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: c("Home"), to: "/" }, { label: c("Invest"), to: "/invest" }, { label: c("Investor Tools") }]} />

      <div className="mt-4">
        <SectionHeading
          as="h1"
          kicker={c("Investor tools")}
          title={c("Run the numbers before you fall for the photos")}
          description={c("Five deterministic calculators for Dubai property decisions. Every input is yours, every assumption is labeled, and every result is a scenario — never a guarantee.")}
        />
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CALCULATOR_TOOLS.map((t, i) => (
          <Link
            key={t.key}
            to={`/calculators/${t.key}`}
            className="group relative flex flex-col rounded-xl border border-border/70 bg-card p-6 transition-ui hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg"
          >
            <div className="flex items-start justify-between">
              <span className="rounded-xl border border-brand/20 bg-brand-soft/60 p-3 text-brand-strong transition-ui group-hover:bg-brand group-hover:text-white" aria-hidden>
                <t.icon className="h-5 w-5" />
              </span>
              <span className="num text-xs font-semibold text-brand-strong/40">0{i + 1}</span>
            </div>
            <h2 className="mt-4 font-display text-lg font-semibold tracking-tight group-hover:text-brand-strong">{c(t.title)}</h2>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{c(t.blurb)}</p>
            <ul className="mt-4 space-y-1.5">
              {t.outputs.map((o) => (
                <li key={c(o)} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  {c(o)}
                </li>
              ))}
            </ul>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-strong">
              {c("Open calculator")}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ltr:group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" aria-hidden />
            </span>
          </Link>
        ))}

        {/* Methodology card */}
        <div className="flex flex-col rounded-xl border border-border/70 bg-sand/60 p-6">
          <p className="kicker">{c("Method, not magic")}</p>
          <h2 className="mt-2 font-display text-lg font-semibold">{c("How these tools treat numbers")}</h2>
          <ul className="mt-3 flex-1 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <strong className="font-semibold text-brand-strong">{c("Deterministic")}</strong> — {c("same inputs, same outputs, every time. No hidden models.")}
            </li>
            <li>
              <strong className="font-semibold text-brand-strong">{c("Labeled")}</strong> — {c("facts, assumptions and projections are visually separated.")}
            </li>
            <li>
              <strong className="font-semibold text-brand-strong">{c("Local")}</strong> — {c("calculations run in your browser; nothing is submitted.")}
            </li>
          </ul>
          <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
            {c("Nothing here is investment, legal or tax advice. Verify against current market data before transacting.")}
          </p>
        </div>
      </div>
    </div>
  );
}

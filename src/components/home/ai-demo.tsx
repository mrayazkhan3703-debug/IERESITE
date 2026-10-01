"use client";

/**
 * AI Advisor Demonstration (V2 §11.8) — a realistic structured interaction,
 * statically rendered from live platform data (no AI call on the homepage).
 * Layout mirrors real advisor output: market context, inventory, rent, yield
 * with MODELED annotation, trade-offs and cited sources.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { DataStateBadge } from "@/components/common";
import { MobileDisclosure } from "@/components/common/mobile-disclosure";
import { Sparkles, User, Scale } from "lucide-react";
import { t, intlLocale, type Locale } from "@/lib/i18n";
import { formatNumber, formatMoney, formatDate } from "@/lib/money";
import { formatPctPrecise } from "@/lib/format-precise";
import type { CommunityCardDTO } from "@/lib/types";
import type { CommunityMetricSet } from "@/components/home/use-home-data";

export function AiDemo({
  locale,
  communities,
  communityMetrics,
}: {
  locale: Locale;
  communities: CommunityCardDTO[] | null;
  communityMetrics: Record<string, CommunityMetricSet> | null;
}) {
  const l = intlLocale(locale);
  const get = (slug: string) => ({
    metrics: communityMetrics?.[slug],
    listingCount: communities?.find((c) => c.slug === slug)?.listingCount ?? null,
  });
  const dt = get("downtown-dubai");
  const bb = get("business-bay");
  const checks = locale === "ar" ? [
    "راجع مصدر وتاريخ كل مقياس قبل مقارنة المناطق.",
    "تحقق من سعر الإيجار ورسوم الخدمة والمستندات لكل عقار.",
    "القيم غير المتاحة تظهر بشرطة؛ لا يمكن استنتاج أفضل استثمار منها.",
  ] : [
    "Check the source and date of each metric before comparing areas.",
    "Verify rent, service charges and documents for each property.",
    "Unavailable values show a dash; they cannot establish a better investment.",
  ];

  const rows: { label: string; render: (side: ReturnType<typeof get>) => React.ReactNode }[] = [
    {
      label: t("home.aidemo.psqft", locale),
      render: (side) =>
        side.metrics?.avgPricePerSqft != null ? (
          <span className="data-value">{formatMoney(String(Math.round(side.metrics.avgPricePerSqft * 100)), { currency: "AED", compact: true })}/sqft</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      label: t("home.aidemo.rent", locale),
      render: (side) =>
        side.metrics?.avgRent1Br != null ? (
          <span className="data-value">{formatMoney(String(Math.round(side.metrics.avgRent1Br * 100)), { currency: "AED", compact: true })}/yr</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      label: t("home.aidemo.yield", locale),
      render: (side) =>
        side.metrics?.yieldPct != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="data-value">{formatPctPrecise(side.metrics.yieldPct, 1)}</span>
            <DataStateBadge state="MODELED" />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      label: t("home.aidemo.inventory", locale),
      render: (side) => (side.listingCount !== null ? <span className="num">{formatNumber(side.listingCount)}</span> : <span className="text-muted-foreground">—</span>),
    },
  ];

  return (
    <section className="section-plain section" aria-labelledby="aidemo-heading">
      <div className="container-page">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="kicker mb-2">{t("home.aidemo.kicker", locale)}</p>
            <h2 id="aidemo-heading" className="type-h2">
              {t("home.aidemo.title", locale)}
            </h2>
            <p className="mt-3 max-w-md text-balance text-muted-foreground">{t("home.aidemo.subtitle", locale)}</p>
            <div className="mt-7">
              <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
                <Link to="/advisor">
                  <Sparkles className="h-4 w-4" aria-hidden /> {t("home.aidemo.cta", locale)}
                </Link>
              </Button>
            </div>
          </div>

          {/* Conversation transcript card — real platform data, static render */}
          <div className="min-w-0 lg:col-span-7">
            <div className="rounded-xl border border-border/70 bg-card shadow-[0_18px_50px_-24px_rgba(0,0,0,0.18)]">
              <div className="border-b border-border/60 px-5 py-3.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Sparkles className="h-4 w-4 text-brand" aria-hidden /> {locale === "ar" ? "مستشار العقارات بالذكاء الاصطناعي" : "AI Property Advisor"}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{t("home.aidemo.demoNote", locale)}</span>
                </p>
              </div>

              <div className="space-y-5 p-5">
                {/* User message */}
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <User className="h-4 w-4" aria-hidden />
                  </span>
                  <p className="rounded-xl rounded-tl-sm border border-border/70 bg-secondary/60 px-4 py-2.5 text-sm leading-relaxed text-ink">
                    {locale === "ar" ? "ما البيانات المتاحة لمقارنة وسط مدينة دبي والخليج التجاري؟" : "What data is available to compare Downtown Dubai and Business Bay?"}
                  </p>
                </div>

                {/* Structured assistant reply */}
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-border/70 bg-sand/40 px-4 py-3.5">
                    <p className="text-sm leading-relaxed text-ink">
                      {locale === "ar" ? "هذا مثال ثابت للبيانات المتاحة على المنصة، وليس إجابة مولدة. القيم غير المتاحة لا تدعم مقارنة استثمارية." : "This static example shows available platform data, not a generated answer. Missing values do not support an investment comparison."}
                    </p>

                    <div className="scroll-elegant mt-4 overflow-x-safe rounded-lg border border-border/70 bg-card">
                      <table className="w-full text-sm">
                        <caption className="sr-only">Downtown Dubai versus Business Bay, AED 3M rental investment</caption>
                        <thead>
                          <tr className="border-b border-border/70 bg-sand/60 text-left whitespace-nowrap">
                            <th scope="col" className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" aria-hidden /> {locale === "ar" ? "المقياس" : "Metric"}</span>
                            </th>
                            <th scope="col" className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{locale === "ar" ? "وسط مدينة دبي" : "Downtown Dubai"}</th>
                            <th scope="col" className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{locale === "ar" ? "الخليج التجاري" : "Business Bay"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.label} className="border-b border-border/50 last:border-0">
                              <th scope="row" className="px-3.5 py-2.5 text-start font-medium text-muted-foreground">{row.label}</th>
                              <td className="px-3.5 py-2.5 text-ink">{row.render(dt)}</td>
                              <td className="px-3.5 py-2.5 text-ink">{row.render(bb)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4">
                      {/* §18.5 mobile: compact demo — trade-offs collapse behind
                          a 44px toggle; always visible from sm up. Sources and
                          data-state badges stay visible at every size. */}
                      <MobileDisclosure label={t("home.aidemo.tradeoffs", locale)} contentClassName="space-y-1.5">
                        <ul className="space-y-1.5">
                          {checks.map((line) => (
                            <li key={line} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/90">
                              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
                              {line}
                            </li>
                          ))}
                        </ul>
                      </MobileDisclosure>
                    </div>

                    <div className="mt-4 border-t border-border/60 pt-3">
                      <p className="type-label text-[10px] text-muted-foreground">{t("home.aidemo.sources", locale)}</p>
                      <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        {[dt, bb].map((side, index) => (
                          <li key={index} className="flex flex-wrap items-center gap-1.5">
                            {index === 0 ? (locale === "ar" ? "وسط مدينة دبي" : "Downtown Dubai") : (locale === "ar" ? "الخليج التجاري" : "Business Bay")}: {side.metrics?.sourceName ?? (locale === "ar" ? "لا يوجد مصدر مقياس متاح" : "No metric source available")}
                            {side.metrics?.periodEnd && ` · ${formatDate(side.metrics.periodEnd, l, { year: "numeric", month: "short", day: "numeric" })}`}
                            {side.metrics?.state && <DataStateBadge state={side.metrics.state} />}
                          </li>
                        ))}
                        <li>{locale === "ar" ? "أعداد المخزون من السجلات العامة الحالية؛ قد تتضمن إعلانات توضيحية تحمل علامتها." : "Inventory counts use current public records; illustrative listings retain their labels."}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

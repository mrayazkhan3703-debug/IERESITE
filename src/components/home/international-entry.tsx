"use client";

/**
 * International Investor Entry (V2 §11.12) — three-card entry for overseas
 * buyers with a locale-aware guidance line. No legal claims; guides carry
 * their own source-dating and review cadence.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Globe2, FileCheck2, Landmark, Languages } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

const CARDS = [
  {
    icon: Globe2,
    titleKey: "home.intl.why",
    to: "/international",
    text: "Why Dubai — market structure, freehold zones for foreign nationals, and how the platform evidences every figure.",
  },
  {
    icon: FileCheck2,
    titleKey: "home.intl.buying",
    to: "/international/buying-remotely",
    text: "The buying process end to end — remote verification, escrow, transfer and handover, with source-dated steps.",
  },
  {
    icon: Landmark,
    titleKey: "home.intl.financing",
    to: "/international/financing-for-expats",
    text: "Financing for international buyers — mortgage options, documentation and loan-to-value for non-residents.",
  },
] as const;

export function InternationalEntry({ locale }: { locale: Locale }) {
  return (
    <section className="section-contrast section-sm" aria-labelledby="intl-heading">
      <div className="container-page">
        <div className="mb-6 max-w-2xl">
          <p className="kicker mb-2">{t("home.intl.kicker", locale)}</p>
          <h2 id="intl-heading" className="type-h2">
            {t("home.intl.title", locale)}
          </h2>
          <p className="mt-2 text-balance text-muted-foreground">{t("home.intl.subtitle", locale)}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {CARDS.map((card) => (
            <Link
              key={card.titleKey}
              to={card.to}
              className="group rounded-xl border border-border/70 bg-card p-5 transition-ui hover:border-brand/40 hover:shadow-md"
            >
              <card.icon className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-display text-base font-semibold text-ink group-hover:text-brand-strong">
                {t(card.titleKey, locale)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{card.text}</p>
              <span className="mt-3 inline-block text-sm font-medium text-brand-strong">Read the guide →</span>
            </Link>
          ))}
        </div>

        {locale === "ar" ? (
          <p className="mt-5 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-faint px-4 py-3 text-sm text-brand-strong">
            <Languages className="h-4 w-4 shrink-0" aria-hidden />
            هذا المركز متاح بالكامل بالعربية — يمكنك التبديل بين الإنجليزية والعربية من أعلى الصفحة في أي وقت.
          </p>
        ) : null}
      </div>
    </section>
  );
}

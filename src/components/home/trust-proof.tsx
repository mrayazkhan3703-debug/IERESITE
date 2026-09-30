"use client";

/**
 * Trust / proof (V2 §11.13) — only verifiable items: company registration
 * framing, advisor credentials count, published research count, response
 * commitment (labeled operational claim). No awards, no client results.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { BadgeCheck, BookOpen, Users, Timer, Info } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/money";
import { SITE_CONTACT_CHANNELS } from "@/lib/config";
import { useSiteSettings } from "@/components/providers/site-settings-provider";

export function TrustProof({
  locale,
  advisorCount,
  researchCount,
}: {
  locale: Locale;
  advisorCount: number | null;
  researchCount: number | null;
}) {
  const settings = useSiteSettings();
  const items = [
    {
      icon: BadgeCheck,
      label: t("home.trust.company", locale),
      value: t("home.trust.companyValue", locale),
      note: SITE_CONTACT_CHANNELS.address.demo ? "Registered company details pending production data" : null,
    },
    {
      icon: Users,
      label: t("home.trust.advisors", locale),
      value: advisorCount !== null ? t("home.trust.advisorsValue", locale).replace("{n}", formatNumber(advisorCount)) : "—",
      note: null,
    },
    {
      icon: BookOpen,
      label: t("home.trust.research", locale),
      value: researchCount !== null ? t("home.trust.researchValue", locale).replace("{n}", formatNumber(researchCount)) : "—",
      note: "Published on the platform — countable, not decorative",
    },
    {
      icon: Timer,
      label: t("home.trust.response", locale),
      value: t("home.trust.responseValue", locale),
      note: t("home.trust.operational", locale),
    },
  ];

  return (
    <section className="section-plain section-sm" aria-labelledby="trust-heading">
      <div className="container-page">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker mb-2">{t("home.trust.kicker", locale)}</p>
            <h2 id="trust-heading" className="type-h2">
              {t("home.trust.title", locale)}
            </h2>
          </div>
          <Link to="/about" className="text-sm font-medium text-brand-strong underline-offset-2 hover:underline">
            About the company →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-card p-5">
              <item.icon className="h-5 w-5 text-brand" aria-hidden />
              <p className="type-label mt-3 text-[10px] text-muted-foreground">{item.label}</p>
              <p className="mt-1 font-display text-base font-semibold text-ink">{item.value}</p>
              {item.note && (
                <p className="mt-1.5 text-xs text-muted-foreground/80">
                  {item.note === t("home.trust.operational", locale) ? (
                    <span className="inline-flex items-center gap-1">
                      <Info className="h-3 w-3" aria-hidden /> {item.note}
                    </span>
                  ) : (
                    item.note
                  )}
                </p>
              )}
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {t("home.trust.demoNote", locale)}{" "}
          <span className="num">Contact: {[settings.contact.addressLine1, settings.contact.addressLine2].filter(Boolean).join(", ")}</span>
        </p>
      </div>
    </section>
  );
}

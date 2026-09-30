"use client";

/**
 * Final conversion (V2 §11.14 / V3 §49) — one clear four-way choice:
 * consultation / AI Advisor / WhatsApp / saved-search alert. WhatsApp uses
 * the verified company line with a contextual prefilled message.
 */

import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Phone, Sparkles, MessageCircle, Bell } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { SITE_CONTACT_CHANNELS, WHATSAPP_MESSAGES, companyWhatsappHref } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";
import { useSiteSettings } from "@/components/providers/site-settings-provider";

export function FinalCta({ locale }: { locale: Locale }) {
  const whatsapp = SITE_CONTACT_CHANNELS.whatsapp;
  const settings = useSiteSettings();
  const cta = settings.globalCta;
  const ctaLabel = cta.key ? t(cta.key, locale) : (locale === "ar" ? cta.labelAr : cta.labelEn) ?? "";

  return (
    <section className="section-plain pb-16 pt-4" aria-labelledby="final-heading">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-2xl bg-brand-strong p-8 text-primary-foreground sm:p-12">
          <div className="relative z-10">
            <p className="type-label text-primary-foreground/70">{t("home.final.kicker", locale)}</p>
            <h2 id="final-heading" className="type-h2 mt-3 max-w-xl text-primary-foreground">
              {t("home.final.title", locale)}
            </h2>
            <p className="mt-3 max-w-lg text-balance text-sm leading-relaxed text-primary-foreground/80">
              {t("home.final.subtitle", locale)}
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-auto w-full justify-start gap-2.5 rounded-xl border-primary-foreground/25 bg-primary-foreground/10 px-4 py-3.5 text-start hover:bg-primary-foreground/20"
              >
                <Link to={cta.to}>
                  <Phone className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{ctaLabel}</span>
                    <span className="block text-xs font-normal opacity-75">30 minutes with a specialist</span>
                  </span>
                </Link>
              </Button>

              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-auto w-full justify-start gap-2.5 rounded-xl border-primary-foreground/25 bg-primary-foreground/10 px-4 py-3.5 text-start hover:bg-primary-foreground/20"
              >
                <Link to="/advisor">
                  <Sparkles className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{t("home.final.askAi", locale)}</span>
                    <span className="block text-xs font-normal opacity-75">Structured answers with sources</span>
                  </span>
                </Link>
              </Button>

              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-auto w-full justify-start gap-2.5 rounded-xl border-primary-foreground/25 bg-primary-foreground/10 px-4 py-3.5 text-start hover:bg-primary-foreground/20"
                onClick={() => events.whatsappClick("home_final")}
              >
                <a href={companyWhatsappHref(WHATSAPP_MESSAGES.generic)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{t("home.final.whatsapp", locale)}</span>
                    <span className="num block text-xs font-normal opacity-75">{whatsapp.value}</span>
                  </span>
                </a>
              </Button>

              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-auto w-full justify-start gap-2.5 rounded-xl border-primary-foreground/25 bg-primary-foreground/10 px-4 py-3.5 text-start hover:bg-primary-foreground/20"
              >
                <Link to="/account/saved-searches">
                  <Bell className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{t("home.final.createAlert", locale)}</span>
                    <span className="block text-xs font-normal opacity-75">Watch the market for your criteria</span>
                  </span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import * as React from "react";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading } from "@/components/common";
import { useLeadForm, LeadFormDialog } from "@/components/leads/lead-form";
import { Button } from "@/components/ui/button";
import { SITE_CONTACT, WHATSAPP_MESSAGES, companyWhatsappHref } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";
import { localeOf, t } from "@/lib/i18n";
import { useRoute, Link } from "@/lib/router";
import { MapPin, Phone, MessageCircle, Navigation, CalendarClock } from "lucide-react";

/**
 * Contact view (V3-A): real verified company contact only — office address
 * with directions, main phone, company WhatsApp (contextual prefilled
 * message). No email channel (none supplied — V3-B01), no invented office
 * hours or license placeholders.
 */
export default function ContactView() {
  const leadForm = useLeadForm();
  const loc = useRoute();
  const locale = localeOf(loc.locale);

  usePageMeta({
    title: t("contact.meta.title", locale),
    description: t("contact.meta.description", locale),
  });

  const cards = [
    {
      icon: MapPin,
      label: t("contact.office.label", locale),
      lines: [SITE_CONTACT.addressLine1, SITE_CONTACT.addressLine2] as string[],
      href: SITE_CONTACT.mapsUrl,
      action: t("contact.office.directions", locale),
      external: true,
      onClick: () => events.directionsClick("contact_page"),
    },
    {
      icon: Phone,
      label: t("contact.phone.label", locale),
      lines: [SITE_CONTACT.phone] as string[],
      href: SITE_CONTACT.phoneHref,
      action: t("contact.phone.call", locale),
      external: false,
      onClick: () => events.callClick("contact_page"),
    },
    {
      icon: MessageCircle,
      label: "WhatsApp",
      lines: [SITE_CONTACT.whatsappLabel] as string[],
      href: companyWhatsappHref(WHATSAPP_MESSAGES.generic),
      action: t("contact.whatsapp.open", locale),
      external: true,
      onClick: () => events.whatsappClick("contact_page"),
    },
  ];

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: t("contact.breadcrumb.home", locale), to: "/" }, { label: t("contact.breadcrumb.contact", locale) }]} />
      <div className="mt-4 grid gap-10 lg:grid-cols-2">
        <div>
          <SectionHeading as="h1"
            kicker={t("contact.kicker", locale)}
            title={t("contact.title", locale)}
            description={t("contact.description", locale)}
          />
          <div className="mt-8 space-y-4">
            {cards.map((c) => (
              <div key={c.label} className="flex items-start gap-4 rounded-xl border border-border/70 bg-card p-4">
                <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                  {c.lines.map((line) => (
                    <p key={line} className="num mt-0.5 text-sm font-medium">{line}</p>
                  ))}
                  <a
                    href={c.href}
                    {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    onClick={c.onClick}
                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand-strong underline-offset-2 transition-ui hover:underline"
                  >
                    {c.external && <Navigation className="h-3 w-3" aria-hidden />}
                    {c.action}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:pt-14">
          <div className="rounded-xl border border-brand/30 bg-brand-faint p-6 sm:p-8">
            <h2 className="font-display text-xl font-semibold">{t("contact.form.title", locale)}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("contact.form.description", locale)}
            </p>
            <Button
              className="mt-5 w-full"
              size="lg"
              onClick={() =>
                leadForm.open({
                  formId: "contact_page",
                  intent: "GENERAL",
                  showIntent: true,
                  title: t("contact.form.title", locale),
                  description: t("contact.form.leadDescription", locale),
                })
              }
            >
              {t("contact.form.open", locale)}
            </Button>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Button asChild variant="outline">
                <a href={SITE_CONTACT.phoneHref} onClick={() => events.callClick("contact_page_cta")}>
                  <Phone className="h-4 w-4" aria-hidden /> {t("nav.contact.call", locale)}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={companyWhatsappHref(WHATSAPP_MESSAGES.generic)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => events.whatsappClick("contact_page_cta")}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
                </a>
              </Button>
            </div>
            <Button asChild variant="ghost" className="mt-2.5 w-full gap-2">
              <Link to="/consultation">
                <CalendarClock className="h-4 w-4" aria-hidden /> {t("contact.form.book", locale)}
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <LeadFormDialog context={leadForm.ctx} onClose={leadForm.close} />
    </div>
  );
}

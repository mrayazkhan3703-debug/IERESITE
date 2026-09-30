"use client";

import * as React from "react";
import { Link, useRoute, type QueryValue } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { SITE_LOGO, WHATSAPP_MESSAGES } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import type { SiteSettings } from "@/lib/site-settings";
import { MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * V3 footer (§14): Discover · Intelligence · Company · Legal link columns +
 * an always-visible verified contact block (phone, WhatsApp, 2-line address →
 * maps directions) over the dark ink section. Below 768px the link columns
 * collapse into accessible accordions (single-collapse); the contact block
 * stays expanded. Sticky-footer layout preserved (mt-auto inside the shell's
 * min-h-screen flex column). No email channel (V3-B01), no demo values.
 */
type FooterColumn = SiteSettings["footerColumns"][number];
type FooterLink = FooterColumn["links"][number];

function footerLabel(item: { key?: string; labelEn?: string; labelAr?: string }, locale: Locale) {
  return item.key ? t(item.key, locale) : (locale === "ar" ? item.labelAr : item.labelEn) ?? "";
}

function FooterLinkList({
  links,
  locale,
}: {
  links: FooterLink[];
  locale: Locale;
}) {
  return (
    <ul className="space-y-1 md:space-y-0">
      {links.map((l) => (
        <li key={l.key}>
          <Link
            to={l.to}
            query={l.query}
            className="flex min-h-11 items-center text-sm on-ink-muted transition-ui hover:text-foreground hover:underline md:min-h-0 md:py-1 md:inline"
          >
            {footerLabel(l, locale)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter() {
  const loc = useRoute();
  const locale = (loc.locale as Locale) ?? "en";
  const settings = useSiteSettings();
  const contact = settings.contact;
  const footerColumns = settings.footerColumns;
  const phoneHref = `tel:${contact.phoneE164}`;
  const whatsappHref = `https://wa.me/${contact.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.generic)}`;
  const columnTitle = (column: FooterColumn) => column.key ? t(column.key, locale) : (locale === "ar" ? column.labelAr : column.labelEn) ?? "";
  const year = new Date().getFullYear();

  return (
    <footer
      className="section-ink mt-auto border-t border-border/70 print:hidden"
      role="contentinfo"
    >
      <div className="container-page py-10 md:py-12 lg:py-14">
        <div className="grid gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-6 lg:gap-8">
          {/* Brand + verified contact block — always visible (expanded on mobile) */}
          <div className="md:col-span-2 lg:col-span-2">
            <img
              src={SITE_LOGO.dark}
              alt="Investment Experts"
              width={125}
              height={40}
              className="h-10 w-auto"
              decoding="async"
            />
            <p className="mt-3 max-w-xs text-sm leading-relaxed on-ink-muted">
              {t("footer.description", locale)}
            </p>
            <address className="mt-5 space-y-1 text-sm not-italic">
              <p>
                <a
                  className="flex min-h-11 items-center gap-2.5 on-ink-muted transition-ui hover:text-foreground md:min-h-0"
                  href={phoneHref}
                  onClick={() => events.callClick("footer")}
                >
                  <Phone className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="num">{contact.phoneDisplay}</span>
                </a>
              </p>
              <p>
                <a
                  className="flex min-h-11 items-center gap-2.5 on-ink-muted transition-ui hover:text-foreground md:min-h-0"
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => events.whatsappClick("footer")}
                >
                  <MessageCircle className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="num">{contact.whatsappDisplay}</span>
                </a>
              </p>
              <p className="pt-1">
                <a
                  className="flex items-start gap-2.5 rounded-sm py-1.5 on-ink-muted transition-ui hover:text-foreground"
                  href={contact.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => events.directionsClick("footer")}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="leading-snug">
                    {contact.addressLine1}
                    <span className="block on-ink-muted">{contact.addressLine2}</span>
                  </span>
                </a>
              </p>
            </address>
            <p className="mt-1">
              <a
                className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium on-ink-muted transition-ui hover:text-foreground"
                href={contact.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => events.directionsClick("footer")}
              >
                <Navigation className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                {t("footer.contact.directions", locale)}
              </a>
            </p>
            {contact.officeHours && <p className="mt-2 text-xs on-ink-muted">{contact.officeHours}</p>}
            {settings.socialLinks.length > 0 && <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label={locale === "ar" ? "روابط التواصل الاجتماعي" : "Social media"}>{settings.socialLinks.map((social, index) => <a key={social.platform + index} href={social.href} target="_blank" rel="noopener noreferrer" className="text-xs on-ink-muted underline-offset-2 hover:text-foreground hover:underline">{locale === "ar" ? social.labelAr : social.labelEn}</a>)}</nav>}
          </div>

          {/* Link columns — accordions below 768px (contact block above stays
           * expanded); the CSS-hidden variant is removed from the a11y tree. */}
          <Accordion type="single" collapsible className="md:hidden">
            {footerColumns.map((col) => (
              <AccordionItem key={col.id} value={col.id} className="border-border/60">
                <AccordionTrigger className="min-h-11 py-3 text-sm font-medium text-foreground/90 hover:no-underline [&[data-state=open]>svg]:text-brand">
                  {columnTitle(col)}
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-sm">
                  <FooterLinkList links={col.links} locale={locale} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {/* Link columns — static grid from 768px up */}
          {footerColumns.map((col) => (
            <nav key={col.id} aria-label={columnTitle(col)} className="hidden md:block">
              <h3 className="type-label mb-3 on-ink-muted">{columnTitle(col)}</h3>
              <FooterLinkList links={col.links} locale={locale} />
            </nav>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-border/70 pt-6 text-xs on-ink-muted md:mt-10 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} Investment Experts. {t("footer.rights", locale)}
          </p>
          <p className="max-w-xl leading-relaxed">
            {t("footer.dataNotice", locale)}
          </p>
        </div>
      </div>
    </footer>
  );
}

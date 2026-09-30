"use client";

/**
 * Quick-contact FAB (V3-G §25) — subtle floating action button on GENERIC
 * pages: one tap to WhatsApp the company, call the office, book a
 * consultation or open the contact page.
 *
 * Visibility contract:
 *  - mobile only (<768px — above the global tab bar + safe area, z below the
 *    cookie consent banner);
 *  - HIDDEN on pages with their own contact surface: /advisor (composer),
 *    /contact (the contact page itself), property & project detail (own
 *    sticky action bars), and all /account + /admin routes.
 *
 * 48px circular trigger, aria-labelled, fade-only animation under
 * prefers-reduced-motion. Analytics: call_click / whatsapp_click with the
 * quick_contact_fab context.
 */

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link, useRoute } from "@/lib/router";
import { WHATSAPP_MESSAGES } from "@/lib/config";
import { useSiteSettings } from "@/components/providers/site-settings-provider";
import { events } from "@/lib/analytics-tracker";
import { localeOf, t } from "@/lib/i18n";
import { MessageCircle, Phone, CalendarClock, MoreHorizontal } from "lucide-react";

/** Routes that own their contact surface — the FAB stays out of the way. */
function isFabHidden(path: string): boolean {
  if (path === "/advisor" || path.startsWith("/advisor/")) return true; // has composer
  if (path.startsWith("/account")) return true;
  if (path.startsWith("/admin")) return true;
  if (path === "/contact") return true; // the contact page itself
  // Property detail (own sticky action bar) — but not the search/list or map routes
  if (path.startsWith("/properties/") && path !== "/properties/map") return true;
  // Project detail carries its own mobile sticky CTA bar
  if (path.startsWith("/projects/")) return true;
  return false;
}

export function QuickContactFab() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const settings = useSiteSettings();
  const contact = settings.contact;
  const [open, setOpen] = React.useState(false);

  if (isFabHidden(loc.path)) return null;

  const actions = [
    {
      key: "whatsapp",
      href: `https://wa.me/${contact.whatsappE164.replace(/\D/g, "")}?text=${encodeURIComponent(WHATSAPP_MESSAGES.generic)}`,
      external: true,
      icon: MessageCircle,
      label: t("quickfab.whatsapp", locale),
      onClick: () => events.whatsappClick("quick_contact_fab"),
    },
    {
      key: "call",
      href: `tel:${contact.phoneE164}`,
      external: false,
      icon: Phone,
      label: t("quickfab.call", locale),
      onClick: () => events.callClick("quick_contact_fab"),
    },
    {
      key: "book",
      to: settings.globalCta.to,
      icon: CalendarClock,
      label: t("quickfab.book", locale),
      onClick: () => setOpen(false),
    },
    {
      key: "contact",
      to: "/contact",
      icon: MoreHorizontal,
      label: t("quickfab.contact", locale),
      onClick: () => setOpen(false),
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("quickfab.aria", locale)}
          aria-expanded={open}
          className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-brand/40 bg-brand text-primary-foreground shadow-lg transition-transform motion-reduce:transition-none hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden print:hidden"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        role="dialog"
        aria-label={t("quickfab.aria", locale)}
        className="w-64 p-3 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
      >
        <div className="px-2 pb-2 pt-1">
          <p className="font-display text-sm font-semibold">{t("quickfab.title", locale)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("quickfab.description", locale)}</p>
        </div>
        <div className="space-y-1">
          {actions.map((a) =>
            a.href ? (
              <a
                key={a.key}
                href={a.href}
                {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={a.onClick}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium transition-ui hover:bg-secondary"
              >
                <a.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                {a.label}
              </a>
            ) : (
              <Link
                key={a.key}
                to={a.to!}
                onClick={a.onClick}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium transition-ui hover:bg-secondary"
              >
                <a.icon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                {a.label}
              </Link>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

/**
 * Property share sheet (V3-G §29) — standard share affordance in the sticky
 * decision panel's More sheet (mobile) and action column (desktop).
 *
 * Share MECHANISMS (not company contact): Copy link / WhatsApp with the
 * property contextual message (title + URL) / Email mailto / native
 * navigator.share() when the platform supports it (feature-detected).
 *
 * Analytics: share_open on open, share (channel) per action.
 * Clipboard falls back to execCommand when the async Clipboard API is
 * unavailable or blocked (headless browsers) — and reports honestly when
 * neither works.
 */

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Link2, MessageCircle, Mail, Share2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { events } from "@/lib/analytics-tracker";
import { t, type Locale } from "@/lib/i18n";
import { companyWhatsappHref, WHATSAPP_MESSAGES } from "@/lib/config";
import { cn } from "@/lib/utils";

function supportsNavigatorShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    /* Clipboard API blocked (headless / permissions) — legacy fallback */
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ShareSheet({
  title,
  slug,
  locale = "en",
  variant = "action",
}: {
  /** Property title used in the WhatsApp/mailto payloads. */
  title: string;
  /** Listing slug for share analytics. */
  slug: string;
  locale?: Locale;
  /** "action" = full-width labeled row (More sheet / desktop column);
   *  "inline" = compact outline button (header rows); "icon" = icon-only. */
  variant?: "action" | "inline" | "icon";
}) {
  const [open, setOpen] = React.useState(false);
  const [nativeAvailable] = React.useState(supportsNavigatorShare);

  const handleOpenChange = (o: boolean) => {
    if (o) events.shareOpen(`property:${slug}`);
    setOpen(o);
  };

  const onCopy = async () => {
    const url = window.location.href.split("#")[0];
    const ok = await copyLink(url);
    if (ok) {
      toast.success(t("share.copied", locale));
      events.share(slug, "copy_link");
    } else {
      toast.error(t("share.copyFailed", locale));
    }
    setOpen(false);
  };

  const onWhatsapp = () => {
    events.share(slug, "whatsapp");
    setOpen(false);
    /* href navigates — WhatsApp message already carries title + URL. */
  };

  const onEmail = () => {
    events.share(slug, "email");
    setOpen(false);
  };

  const onNative = async () => {
    const url = window.location.href.split("#")[0];
    events.share(slug, "native");
    setOpen(false);
    try {
      await navigator.share({ title, url });
    } catch {
      /* user dismissed the native sheet — nothing to report */
    }
  };

  const trigger =
    variant === "icon" ? (
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 gap-1.5 sm:h-9 sm:w-9"
        aria-label={t("share.openAria", locale)}
      >
        <Share2 className="h-4 w-4" aria-hidden />
      </Button>
    ) : variant === "inline" ? (
      <Button variant="outline" size="sm" className="gap-1.5" aria-label={t("share.openAria", locale)}>
        <Share2 className="h-4 w-4" aria-hidden /> {t("common.share", locale)}
      </Button>
    ) : (
      <Button
        variant="outline"
        className="h-11 w-full justify-start gap-2 sm:h-9"
        aria-label={t("share.openAria", locale)}
      >
        <Share2 className="h-4 w-4" aria-hidden /> {t("common.share", locale)}
      </Button>
    );

  const rowClass = "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-sm font-medium transition-ui hover:bg-secondary";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        role="dialog"
        aria-label={t("share.title", locale)}
        className={cn("w-64 p-3 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none")}
      >
        <div className="px-2 pb-2 pt-1">
          <p className="font-display text-sm font-semibold">{t("share.title", locale)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("share.description", locale)}</p>
        </div>
        <div className="space-y-1">
          <button type="button" onClick={onCopy} className={rowClass}>
            <Link2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t("share.copyLink", locale)}
          </button>
          <a
            href={companyWhatsappHref(WHATSAPP_MESSAGES.property(title))}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onWhatsapp}
            className={rowClass}
          >
            <MessageCircle className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t("share.whatsapp", locale)}
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(
              typeof window !== "undefined" ? window.location.href.split("#")[0] : ""
            )}`}
            onClick={onEmail}
            className={rowClass}
          >
            <Mail className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t("share.email", locale)}
          </a>
          {nativeAvailable && (
            <button type="button" onClick={onNative} className={rowClass}>
              <MoreHorizontal className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t("share.native", locale)}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

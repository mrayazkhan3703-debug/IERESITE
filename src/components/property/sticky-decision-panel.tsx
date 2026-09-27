"use client";

/**
 * Sticky decision panel (V2 §14.3).
 *
 * Desktop: right-hand sticky card — price, advisor identity + real enquiry-capacity
 * status, primary CTAs (Enquire / WhatsApp / Call / Book viewing), Save + Compare,
 * "Ask AI about this property" and a compact MODELED-labeled investment snapshot.
 *
 * Mobile: the same decisions collapse into a fixed bottom action bar (Call /
 * WhatsApp / Enquire / Save) stacked ABOVE the global mobile tab bar — the
 * documented approach: `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` so the
 * two bars never overlap and no global layout file needs touching. Remaining
 * actions live in a "More" bottom sheet. All touch targets ≥44px, safe-area aware.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { DataStateBadge } from "@/components/common/data-state";
import { AgentAvatar } from "@/components/entity/agent-avatar";
import { ShareSheet } from "./share-sheet";
import { events } from "@/lib/analytics-tracker";
import { formatAEDPrecise, formatPctPrecise, fullValueTooltip } from "@/lib/format-precise";
import { fromMinor } from "@/lib/money";
import { t, type Locale } from "@/lib/i18n";
import { Sparkles, MessageCircle, Phone, CalendarClock, Heart, Scale, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InvestmentSnapshot, PropertyDetailAgent } from "./detail-shared";

export interface StickyDecisionPanelProps {
  price: { minor: string; currency: string; qualifier: string | null; rentFrequency: string | null } | null;
  ppsfMajor: number | null;
  currency: string;
  listingRef: string;
  isSale: boolean;
  agent: PropertyDetailAgent | null;
  whatsappHref: string | null;
  callHref: string;
  callLabel: string;
  bookViewingHref: string;
  askAiHref: string;
  advisorHref: string | null;
  isSaved: boolean;
  onToggleSave: () => void;
  inCompare: boolean;
  onToggleCompare: () => void;
  onEnquire: () => void;
  investmentSnapshot: InvestmentSnapshot | null;
  /** V3-G §29 — property title for the share sheet payloads. */
  shareTitle?: string;
  locale?: Locale;
}

export function StickyDecisionPanel(props: StickyDecisionPanelProps) {
  const {
    price, ppsfMajor, currency, listingRef, isSale, agent,
    whatsappHref, callHref, callLabel, bookViewingHref, askAiHref, advisorHref,
    isSaved, onToggleSave, inCompare, onToggleCompare, onEnquire,
    investmentSnapshot, shareTitle, locale = "en",
  } = props;

  const priceMajor = price ? fromMinor(price.minor) : null;

  const handleWhatsapp = () => events.whatsappClick(`property:${listingRef}`);
  const handleCall = () => events.callClick(`property:${listingRef}`);
  const handleAskAi = () => events.aiRecommendation("property", listingRef);

  const enquireLabel = isSale ? t("property.cta.enquire", locale) : t("property.cta.requestViewing", locale);

  /* ------------------------------------------------------------------ */
  /* Shared action set                                                   */
  /* ------------------------------------------------------------------ */

  const moreActions = (
    <div className="space-y-2">
      <Button asChild variant="outline" className="h-11 w-full justify-start gap-2">
        <Link to={bookViewingHref}>
          <CalendarClock className="h-4 w-4" aria-hidden /> {t("property.cta.bookViewing", locale)}
        </Link>
      </Button>
      <Button
        variant="outline"
        aria-pressed={inCompare}
        className="h-11 w-full justify-start gap-2"
        onClick={onToggleCompare}
      >
        <Scale className={cn("h-4 w-4", inCompare && "text-brand")} aria-hidden />
        {inCompare ? t("property.cta.inCompare", locale) : t("property.cta.compare", locale)}
      </Button>
      <Button asChild variant="outline" className="h-11 w-full justify-start gap-2" onClick={handleAskAi}>
        <Link to={askAiHref}>
          <Sparkles className="h-4 w-4 text-brand" aria-hidden /> {t("property.cta.askAi", locale)}
        </Link>
      </Button>
      {advisorHref && agent && (
        <Button asChild variant="ghost" className="h-11 w-full justify-start gap-2 text-muted-foreground">
          <Link to={advisorHref}>{t("property.cta.advisorProfile", locale)}</Link>
        </Button>
      )}
      {/* §29 — share sheet (Copy link / WhatsApp / Email / native share) */}
      <ShareSheet title={shareTitle ?? listingRef} slug={listingRef} locale={locale} variant="action" />
    </div>
  );

  /* ------------------------------------------------------------------ */
  /* Desktop sticky card                                                 */
  /* ------------------------------------------------------------------ */

  const desktopPanel = (
    <div className="rounded-xl border border-border/70 bg-card p-6 shadow-sm">
      {price && priceMajor !== null ? (
        <>
          <p className="kicker">{isSale ? t("property.panel.askingPrice", locale) : t("property.panel.rent", locale)}</p>
          <p className="num mt-1 font-display text-3xl font-semibold tracking-tight text-ink" title={fullValueTooltip(priceMajor)}>
            {price.qualifier ? `${price.qualifier} ` : ""}
            {formatAEDPrecise(priceMajor)}
            {price.rentFrequency === "YEARLY" && <span className="ml-1 text-sm font-normal text-muted-foreground">/yr</span>}
            {price.rentFrequency === "MONTHLY" && <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>}
          </p>
          {ppsfMajor !== null && (
            <p className="num mt-1 text-sm text-muted-foreground">
              {formatAEDPrecise(ppsfMajor)} / sqft{price.currency !== "AED" ? ` (${price.currency})` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="font-display text-xl font-semibold">{t("property.panel.priceOnApplication", locale)}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("property.panel.ref", locale)}: <span className="num font-medium">{listingRef}</span>
      </p>

      {/* Compact investment snapshot — MODELED-labeled (§14.3) */}
      {investmentSnapshot && (
        <div className="mt-4 rounded-lg border border-brand/25 bg-brand-faint/50 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="kicker">{t("property.panel.snapshot", locale)}</p>
            <DataStateBadge state="MODELED" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.panel.grossYield", locale)}</p>
              <p className="num data-value font-semibold text-brand-strong">{formatPctPrecise(investmentSnapshot.grossYieldPct)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("property.panel.netYield", locale)}</p>
              <p className="num data-value font-semibold text-brand-strong">{formatPctPrecise(investmentSnapshot.netYieldPct)}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("property.panel.basedOn", locale)} {formatAEDPrecise(investmentSnapshot.effectiveMonthlyRent)}/mo{" "}
            {t("property.panel.effectiveRent", locale)}
          </p>
        </div>
      )}

      {/* Advisor (V3-02: the Advisory Desk — central company contact; no
       * unverified capacity or experience claims) */}
      {agent && (
        <div className="mt-5 border-t border-border/60 pt-5">
          <div className="flex items-center gap-3">
            <AgentAvatar
              name={agent.name}
              photoUrl={agent.photoUrl}
              photo={agent.photo}
              alt={agent.name}
              rounded="rounded-full"
              className="h-12 w-12"
            />
            <div className="min-w-0">
              <p className="font-display text-base font-semibold tracking-tight">{agent.name}</p>
              {agent.jobTitle && <p className="text-xs text-muted-foreground">{agent.jobTitle}</p>}
              {agent.slug === "advisory-desk" && (
                <p className="text-[11px] text-muted-foreground">{t("property.panel.deskNote", locale)}</p>
              )}
            </div>
          </div>
          {advisorHref && (
            <Button asChild variant="ghost" size="sm" className="mt-2 h-auto p-0 text-xs text-muted-foreground hover:text-brand-strong">
              <Link to={advisorHref}>{t("property.cta.advisorProfileLink", locale)} →</Link>
            </Button>
          )}
        </div>
      )}

      {/* CTAs */}
      <div className="mt-5 space-y-2.5 print:hidden">
        <Button className="w-full" size="lg" onClick={onEnquire}>
          {enquireLabel}
        </Button>
        {whatsappHref && (
          <Button asChild variant="outline" className="w-full gap-2" onClick={handleWhatsapp}>
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden /> {t("property.cta.whatsapp", locale)}
            </a>
          </Button>
        )}
        <Button asChild variant="outline" className="w-full gap-2" onClick={handleCall}>
          <a href={callHref}>
            <Phone className="h-4 w-4" aria-hidden /> {callLabel}
          </a>
        </Button>
        <Button asChild variant="ghost" className="w-full gap-2 text-muted-foreground">
          <Link to={bookViewingHref}>
            <CalendarClock className="h-4 w-4" aria-hidden /> {t("property.cta.bookViewing", locale)}
          </Link>
        </Button>
        <Separator className="my-1" />
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="outline" aria-pressed={isSaved} className="gap-1.5" onClick={onToggleSave}>
            <Heart className={cn("h-4 w-4", isSaved && "fill-current text-brand")} aria-hidden />
            {isSaved ? t("common.saved", locale) : t("common.save", locale)}
          </Button>
          <Button variant="outline" aria-pressed={inCompare} className="gap-1.5" onClick={onToggleCompare}>
            <Scale className={cn("h-4 w-4", inCompare && "text-brand")} aria-hidden />
            {inCompare ? t("property.cta.inCompare", locale) : t("common.compare", locale)}
          </Button>
        </div>
        <Button asChild variant="ghost" className="w-full gap-2 text-brand-strong hover:text-brand-strong/90" onClick={handleAskAi}>
          <Link to={askAiHref}>
            <Sparkles className="h-4 w-4" aria-hidden /> {t("property.cta.askAi", locale)}
          </Link>
        </Button>
        {/* §29 — share sheet in the desktop action column too */}
        <div className="flex justify-center">
          <ShareSheet title={shareTitle ?? listingRef} slug={listingRef} locale={locale} variant="inline" />
        </div>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /* Mobile fixed bottom action bar (stacked above the global tab bar)   */
  /* ------------------------------------------------------------------ */

  const mobileBar = (
    <div
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden print:hidden"
      role="region"
      aria-label={t("property.panel.mobileBarAria", locale)}
    >
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-stretch gap-1 px-2 py-2">
        <a
          href={callHref}
          onClick={handleCall}
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-foreground transition-ui hover:bg-secondary"
        >
          <Phone className="h-5 w-5 text-brand" aria-hidden />
          {t("property.cta.call", locale)}
        </a>
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleWhatsapp}
            className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-foreground transition-ui hover:bg-secondary"
          >
            <MessageCircle className="h-5 w-5 text-brand" aria-hidden />
            {t("property.cta.whatsapp", locale)}
          </a>
        ) : (
          <span className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium text-muted-foreground/50">
            <MessageCircle className="h-5 w-5" aria-hidden />
            {t("property.cta.whatsapp", locale)}
          </span>
        )}
        <button
          type="button"
          onClick={onEnquire}
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg bg-brand px-1 text-[11px] font-semibold text-primary-foreground transition-ui hover:bg-brand-strong"
        >
          <CalendarClock className="h-5 w-5" aria-hidden />
          {enquireLabel}
        </button>
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("property.cta.more", locale)}
              className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-medium text-foreground transition-ui hover:bg-secondary"
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden />
              {t("property.cta.more", locale)}
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[calc(1rem+env(safe-area-inset-bottom))]" aria-describedby={undefined}>
            <SheetHeader className="pb-0">
              <SheetTitle>{t("property.cta.moreTitle", locale)}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-2">
              <button
                type="button"
                onClick={onToggleSave}
                aria-pressed={isSaved}
                className="mb-3 flex h-11 w-full items-center justify-start gap-2 rounded-lg border border-border/70 px-4 text-sm font-medium transition-ui hover:border-brand/40"
              >
                <Heart className={cn("h-4 w-4", isSaved && "fill-current text-brand")} aria-hidden />
                {isSaved ? t("common.saved", locale) : t("common.save", locale)}
              </button>
              {moreActions}
              {price && priceMajor !== null && (
                <p className="num mt-4 text-center text-sm text-muted-foreground" title={fullValueTooltip(priceMajor)}>
                  {formatAEDPrecise(priceMajor)}
                  {ppsfMajor !== null && <span className="ml-2 text-xs">· {formatAEDPrecise(ppsfMajor)}/sqft</span>}
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop/tablet card — printed inline after the content column */}
      <div className="print:break-inside-avoid">{desktopPanel}</div>
      {mobileBar}
    </>
  );
}

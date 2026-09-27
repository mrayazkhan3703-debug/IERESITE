"use client";

import * as React from "react";
import { Link, useRoute, setLocale, navigate, type QueryValue } from "@/lib/router";
import { t, dir, type Locale } from "@/lib/i18n";
import { SITE_CONTACT, SITE_LOGO as LOGO, WHATSAPP_MESSAGES, companyWhatsappHref } from "@/lib/config";
import { events } from "@/lib/analytics-tracker";
import { useAuth } from "@/components/providers/auth-provider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Globe,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  Navigation,
  Phone,
  Search,
  Sparkles,
  User,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* V2 desktop IA (§10) + V3-03 responsive tiers (§9/§15):              */
/*   <1024px  — logo + search/AI/account icons + hamburger drawer      */
/*   1024–1279 — compact dropdowns + Search/AI/Account + hamburger     */
/*   ≥1280px — full 4-group IA + utility rail (contact menu, lang)     */
/* ------------------------------------------------------------------ */

interface NavItem {
  to: string;
  key: string;
  query?: Record<string, QueryValue>;
}

interface NavGroup {
  id: string;
  key: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "properties",
    key: "nav.groups.properties",
    items: [
      { to: "/buy", key: "nav.buy" },
      { to: "/rent", key: "nav.rent" },
      { to: "/off-plan", key: "nav.offPlan" },
      { to: "/projects", key: "nav.newLaunches", query: { sort: "new" } },
    ],
  },
  {
    id: "explore",
    key: "nav.groups.explore",
    items: [
      { to: "/communities", key: "nav.communities" },
      { to: "/developers", key: "nav.developers" },
      { to: "/properties/map", key: "nav.map" },
      { to: "/market", key: "nav.market" },
    ],
  },
  {
    id: "invest",
    key: "nav.groups.invest",
    items: [
      { to: "/invest/opportunities", key: "nav.opportunities" },
      { to: "/calculators", key: "nav.investorTools" },
      { to: "/market", key: "nav.reports" },
      { to: "/international", key: "nav.internationalBuyers" },
    ],
  },
];

const ADVISORS_ITEM: NavItem = { to: "/agents", key: "nav.groups.advisors" };

/**
 * V3-03 mobile drawer groups (§9): Properties · Explore Dubai · Invest ·
 * Company — the single source of navigation below 1024px.
 */
const DRAWER_GROUPS: { key: string; items: NavItem[] }[] = [
  ...NAV_GROUPS.map((g) => ({ key: g.key, items: g.items })),
  {
    key: "nav.groups.company",
    items: [
      ADVISORS_ITEM,
      { to: "/about/team", key: "footer.company.team" },
      { to: "/about", key: "footer.company.about" },
      { to: "/contact", key: "footer.company.contact" },
    ],
  },
];

function isItemActive(path: string, to: string): boolean {
  return path === to || path.startsWith(to + "/");
}

/** Single best-matching nav target (longest active prefix wins; first on ties). */
function useActiveTarget(path: string): { to: string; groupId: string } | null {
  return React.useMemo(() => {
    let best: { to: string; groupId: string } | null = null;
    const consider = (item: NavItem, groupId: string) => {
      if (!isItemActive(path, item.to)) return;
      if (!best || item.to.length > best.to.length) best = { to: item.to, groupId };
    };
    for (const g of NAV_GROUPS) for (const item of g.items) consider(item, g.id);
    consider(ADVISORS_ITEM, "advisors");
    return best;
  }, [path]);
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const triggerBase =
  "relative inline-flex h-9 items-center whitespace-nowrap rounded-md bg-transparent px-3 text-sm font-medium text-foreground/80 transition-ui hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground";

function ActiveUnderline() {
  return (
    <span aria-hidden className="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-brand" />
  );
}

/** Dropdown row: nav link + mirrored chevron affordance (RTL-safe). */
function NavRow({
  item,
  locale,
  active,
  onNavigate,
}: {
  item: NavItem;
  locale: Locale;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.to}
      query={item.query}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/row flex items-center justify-between gap-6 rounded-md px-3 py-2 text-sm transition-ui hover:bg-secondary hover:text-foreground focus-visible:bg-secondary",
        active ? "font-medium text-brand-strong" : "text-foreground/80"
      )}
    >
      <span className="whitespace-nowrap">{t(item.key, locale)}</span>
      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-ui group-hover/row:opacity-100 rtl:rotate-180"
      />
    </Link>
  );
}

/**
 * Hover + click dropdown (1024–1279px tier + utilities).
 * Radix DropdownMenu primitives provide keyboard access (aria-expanded,
 * arrow navigation); hover intent is layered on top with a 150ms grace
 * period that covers the trigger→portal gap.
 */
function HoverDropdown({
  label,
  active,
  ariaLabel,
  align = "start",
  widthClass = "w-60",
  children,
}: {
  label: string;
  active?: boolean;
  ariaLabel: string;
  align?: "start" | "center" | "end";
  widthClass?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  const cancel = React.useCallback(() => window.clearTimeout(timer.current), []);
  const openNow = React.useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel]);
  const closeSoon = React.useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => setOpen(false), 150);
  }, [cancel]);
  React.useEffect(() => cancel, [cancel]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={ariaLabel} className={cn(triggerBase, "group", active && "text-brand-strong")}>
            {label}
            <ChevronDown
              aria-hidden
              className="ms-0.5 size-3 transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
            {active && <ActiveUnderline />}
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align={align}
        className={cn(widthClass, "p-1.5")}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact contact menu (≥1280px): phone icon trigger, never a raw number. */
function ContactMenu({ locale }: { locale: Locale }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("nav.utilities.contact", locale)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-ui hover:bg-secondary hover:text-foreground"
        >
          <Phone className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-1.5">
        <DropdownMenuLabel className="type-label px-2 pb-1 pt-1.5 text-muted-foreground">
          {t("nav.contact.title", locale)}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={SITE_CONTACT.phoneHref} className="num whitespace-nowrap" onClick={() => events.callClick("header")}>
            <Phone aria-hidden />
            <span className="flex-1">{t("nav.contact.call", locale)}</span>
            <span className="text-muted-foreground">{SITE_CONTACT.phone}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={companyWhatsappHref(WHATSAPP_MESSAGES.generic)}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap"
            onClick={() => events.whatsappClick("header")}
          >
            <MessageCircle aria-hidden />
            <span className="flex-1">{t("nav.contact.whatsapp", locale)}</span>
            <span className="text-muted-foreground">{SITE_CONTACT.whatsappLabel}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/contact")}>
          <MessageSquare aria-hidden />
          {t("footer.company.contact", locale)}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={SITE_CONTACT.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap"
            onClick={() => events.directionsClick("header")}
          >
            <Navigation aria-hidden />
            <span className="flex-1">{t("footer.contact.directions", locale)}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/consultation")}>
          <CalendarClock aria-hidden />
          {t("nav.contact.book", locale)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile drawer (V3-03 §9) — accessible Sheet                          */
/* ------------------------------------------------------------------ */

/**
 * Full-navigation drawer for <1280px (primary nav below 1024px; secondary
 * access on tablets). Radix Dialog provides the focus trap, Escape-to-close,
 * focus restoration to the hamburger, body scroll lock, role="dialog" and
 * aria-modal; the hamburger trigger carries aria-expanded from Radix.
 */
function MobileDrawer({
  locale,
  path,
  open,
  setOpen,
}: {
  locale: Locale;
  path: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  /* Drawer opens from the hamburger's edge: right in LTR, left in RTL. */
  const side = locale === "ar" ? "left" : "right";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) events.mobileMenuOpen();
      }}
    >
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-11 p-0 xl:hidden"
          aria-label={t("nav.menu.open", locale)}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side={side}
        aria-modal={true}
        className="flex h-full w-[min(20rem,100vw)] flex-col gap-0 p-0 sm:max-w-none data-[state=open]:duration-200 data-[state=closed]:duration-150"
      >
        <SheetHeader className="space-y-0 border-b border-border/70 p-4">
          <SheetTitle className="text-start">
            <img
              src={LOGO.light}
              alt="Investment Experts"
              width={94}
              height={30}
              className="h-[30px] w-auto"
              decoding="async"
            />
          </SheetTitle>
          <SheetDescription className="sr-only">{t("nav.menu.description", locale)}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <nav aria-label={t("nav.menu.description", locale)} className="flex flex-col gap-5 p-4">
            {DRAWER_GROUPS.map((group) => (
              <div key={group.key}>
                <h3 className="type-label mb-1.5 px-3 text-muted-foreground">{t(group.key, locale)}</h3>
                <ul className="grid gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.to + item.key}>
                      <Link
                        to={item.to}
                        query={item.query}
                        onClick={() => {
                          setOpen(false);
                          events.mobileMenuItemClick(item.to);
                        }}
                        aria-current={isItemActive(path, item.to) ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center rounded-md px-3 py-2.5 text-base font-medium transition-ui hover:bg-secondary",
                          isItemActive(path, item.to) ? "text-brand-strong" : "text-foreground/85"
                        )}
                      >
                        {t(item.key, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Drawer footer — always reachable contact block + language switch */}
        <div className="border-t border-border/70 p-4">
          <h3 className="type-label mb-2 text-muted-foreground">{t("nav.contact.visit", locale)}</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild className="h-11 justify-center">
              <a href={SITE_CONTACT.phoneHref} className="num" onClick={() => events.callClick("header_sheet")}>
                <Phone className="h-4 w-4" aria-hidden />
                {t("nav.contact.call", locale)}
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11 justify-center">
              <a
                href={companyWhatsappHref(WHATSAPP_MESSAGES.generic)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => events.whatsappClick("header_sheet")}
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                {t("nav.contact.whatsapp", locale)}
              </a>
            </Button>
          </div>
          <a
            href={SITE_CONTACT.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => events.directionsClick("header_sheet")}
            className="mt-3 flex min-h-11 items-start gap-2.5 rounded-md px-1 py-1.5 text-sm text-foreground/85 transition-ui hover:bg-secondary hover:text-foreground"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span className="leading-snug">
              {SITE_CONTACT.addressLine1}
              <span className="block text-muted-foreground">{SITE_CONTACT.addressLine2}</span>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-strong">
                {t("footer.contact.directions", locale)}
                <Navigation className="h-3 w-3 rtl:rotate-180" aria-hidden />
              </span>
            </span>
          </a>
          <Button
            variant="ghost"
            className="mt-1 h-11 w-full justify-center"
            onClick={() => {
              setLocale(locale === "en" ? "ar" : "en");
              setOpen(false);
            }}
          >
            <Globe className="h-4 w-4" aria-hidden />
            {locale === "en" ? "العربية" : "English"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function SiteHeader() {
  const loc = useRoute();
  const locale = (loc.locale as Locale) ?? "en";
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [menuValue, setMenuValue] = React.useState("");

  /* §17 subtle header elevation — at rest the bar is calm and translucent;
   * past 8px of scroll it gains an opaque-ish surface, hairline border and a
   * 12px soft shadow (200ms transition, instant under reduced-motion via the
   * global override). Border width is identical in both states → zero CLS. */
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const active = useActiveTarget(loc.path);
  const activeGroupId = active?.groupId ?? null;
  const advisorsActive = activeGroupId === "advisors";
  const closeMenu = () => setMenuValue("");

  const openPalette = () =>
    document.dispatchEvent(new CustomEvent("ie:open-command-palette"));

  return (
    <header
      data-scrolled={scrolled ? "true" : undefined}
      className={cn(
        "sticky top-0 z-50 w-full border-b backdrop-blur transition-[background-color,border-color,box-shadow] duration-200 print:hidden",
        scrolled
          ? "border-border/70 bg-background/95 shadow-[0_1px_12px_rgba(40,36,32,0.08)] supports-[backdrop-filter]:bg-background/90"
          : "border-transparent bg-background supports-[backdrop-filter]:bg-background/65"
      )}
    >
      <div className="container-page">
        <div className="flex h-16 items-center justify-between gap-2 md:gap-3 xl:gap-4">
          {/* Official logo (V3-01) — ink-adapted variant for the light header;
           * compact 28px below sm so the 320px tier never overflows. */}
          <Link
            to="/"
            className="flex shrink-0 items-center focus-visible:outline-offset-4"
            aria-label="Investment Experts — home"
            onClick={() => events.logoClick("header")}
          >
            <img
              src={LOGO.light}
              alt="Investment Experts"
              width={100}
              height={32}
              className="h-7 w-auto sm:h-8"
              decoding="async"
            />
          </Link>

          {/* Desktop nav (≥1280px): 4 groups + Advisors */}
          <nav aria-label="Primary" className="hidden items-center xl:flex">
            {/* dir prop: Radix defaults to "ltr" which un-mirrors the flex list
             * under html[rtl] (U21 fix) — pass the active locale direction so the
             * nav groups read right-to-left in Arabic and arrows keys match. */}
            <NavigationMenu value={menuValue} onValueChange={setMenuValue} viewport={false} dir={dir(locale)}>
              <NavigationMenuList className="gap-0.5">
                {NAV_GROUPS.map((group) => {
                  const groupActive = activeGroupId === group.id;
                  return (
                    <NavigationMenuItem key={group.id}>
                      <NavigationMenuTrigger
                        className={cn(
                          triggerBase,
                          "px-3",
                          groupActive && "text-brand-strong"
                        )}
                      >
                        {t(group.key, locale)}
                        {groupActive && <ActiveUnderline />}
                      </NavigationMenuTrigger>
                      <NavigationMenuContent className="w-60 p-1.5 pr-1.5">
                        <div className="type-label px-3 pb-1 pt-1.5 text-muted-foreground">
                          {t(group.key, locale)}
                        </div>
                        <ul className="grid gap-0.5">
                          {group.items.map((item) => (
                            <li key={item.key}>
                              <NavRow
                                item={item}
                                locale={locale}
                                active={isItemActive(loc.path, item.to)}
                                onNavigate={closeMenu}
                              />
                            </li>
                          ))}
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>
                  );
                })}
                <NavigationMenuItem>
                  <Link
                    to={ADVISORS_ITEM.to}
                    aria-current={advisorsActive ? "page" : undefined}
                    className={cn(
                      triggerBase,
                      "px-3",
                      advisorsActive ? "text-brand-strong" : "text-foreground/80"
                    )}
                  >
                    {t(ADVISORS_ITEM.key, locale)}
                    {advisorsActive && <ActiveUnderline />}
                  </Link>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </nav>

          {/* Tablet nav (1024–1279px): Properties + More + Advisors (compact) */}
          <div className="hidden items-center gap-0.5 lg:flex xl:hidden">
            <HoverDropdown
              label={t("nav.groups.properties", locale)}
              active={activeGroupId === "properties"}
              ariaLabel={t("nav.groups.properties", locale)}
            >
              {NAV_GROUPS[0].items.map((item) => (
                <NavRow
                  key={item.key}
                  item={item}
                  locale={locale}
                  active={isItemActive(loc.path, item.to)}
                  onNavigate={closeMenu}
                />
              ))}
            </HoverDropdown>

            <HoverDropdown
              label={t("nav.more", locale)}
              ariaLabel={t("nav.more", locale)}
              widthClass="w-64"
            >
              {NAV_GROUPS.slice(1).map((group, gi) => (
                <React.Fragment key={group.id}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="type-label px-2 pb-1 pt-1.5 text-muted-foreground">
                    {t(group.key, locale)}
                  </DropdownMenuLabel>
                  {group.items.map((item) => (
                    <NavRow
                      key={item.key}
                      item={item}
                      locale={locale}
                      active={isItemActive(loc.path, item.to)}
                      onNavigate={closeMenu}
                    />
                  ))}
                </React.Fragment>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="type-label px-2 pb-1 pt-1.5 text-muted-foreground">
                {t("nav.groups.company", locale)}
              </DropdownMenuLabel>
              <NavRow
                item={ADVISORS_ITEM}
                locale={locale}
                active={isItemActive(loc.path, ADVISORS_ITEM.to)}
                onNavigate={closeMenu}
              />
              <NavRow
                item={{ to: "/about/team", key: "footer.company.team" }}
                locale={locale}
                active={isItemActive(loc.path, "/about/team")}
                onNavigate={closeMenu}
              />
              <NavRow
                item={{ to: "/about", key: "footer.company.about" }}
                locale={locale}
                active={isItemActive(loc.path, "/about")}
                onNavigate={closeMenu}
              />
              <NavRow
                item={{ to: "/contact", key: "footer.company.contact" }}
                locale={locale}
                active={isItemActive(loc.path, "/contact")}
                onNavigate={closeMenu}
              />
            </HoverDropdown>

            <Link
              to={ADVISORS_ITEM.to}
              aria-current={advisorsActive ? "page" : undefined}
              className={cn(triggerBase, advisorsActive && "text-brand-strong")}
            >
              {t(ADVISORS_ITEM.key, locale)}
              {advisorsActive && <ActiveUnderline />}
            </Link>
          </div>

          {/* Utility rail — compact, never wraps.
           * <1024px: Search · AI · Account · hamburger (language + contact live
           * in the drawer); 1024–1279: same + compact dropdowns; ≥1280: full
           * rail with contact menu + language switch. */}
          <div className="flex flex-nowrap items-center gap-1 md:gap-1.5">
            {/* Command palette trigger (≥768px) */}
            <button
              type="button"
              onClick={openPalette}
              className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border/70 bg-card px-3 text-sm text-muted-foreground transition-ui hover:border-brand/40 hover:text-foreground md:flex"
              aria-label={t("nav.utilities.search", locale) + " (Ctrl+K)"}
            >
              <Search className="h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">{t("nav.utilities.search", locale)}…</span>
              <kbd className="pointer-events-none hidden rounded border border-border bg-sand px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground lg:inline-flex">
                ⌘K
              </kbd>
            </button>

            {/* Mobile search icon (44px touch target) */}
            <button
              type="button"
              onClick={openPalette}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-ui hover:text-foreground md:hidden"
              aria-label={t("nav.utilities.search", locale)}
            >
              <Search className="h-5 w-5" aria-hidden />
            </button>

            {/* Contact menu (≥1280px) — phone icon trigger + compact dropdown */}
            <div className="hidden xl:block">
              <ContactMenu locale={locale} />
            </div>

            {/* Locale switch (≥1280px; on smaller tiers it lives in the drawer) */}
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 gap-1 whitespace-nowrap px-2 text-muted-foreground xl:flex"
              aria-label={t("nav.utilities.language", locale)}
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            >
              <Globe className="h-4 w-4" aria-hidden />
              <span className="text-xs font-semibold">{locale === "en" ? "ع" : "EN"}</span>
            </Button>

            {/* AI Advisor — icon-button at every tier (44px on mobile) */}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-11 w-11 justify-center p-0 xl:h-9 xl:w-auto xl:justify-start xl:gap-1.5 xl:px-2.5"
            >
              <Link to="/advisor" aria-label={t("nav.advisor", locale)}>
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                <span className="hidden xl:inline">{t("nav.advisor", locale)}</span>
              </Link>
            </Button>

            {/* Account (44px touch target on mobile; also on the tab bar) */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-11 w-11 p-0 md:h-9 md:w-9"
              aria-label={t("nav.utilities.account", locale)}
            >
              <Link to={user ? "/account" : "/account/login"}>
                <User className="h-5 w-5" aria-hidden />
              </Link>
            </Button>

            {/* Hamburger drawer (<1280px) — full nav + contact + language */}
            <MobileDrawer locale={locale} path={loc.path} open={open} setOpen={setOpen} />
          </div>
        </div>
      </div>
    </header>
  );
}

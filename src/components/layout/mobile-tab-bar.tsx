"use client";

import * as React from "react";
import { Link, useRoute } from "@/lib/router";
import { t, type Locale } from "@/lib/i18n";
import { useAuth } from "@/components/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Compass, Map as MapIcon, Sparkles, User, Heart } from "lucide-react";

/**
 * MobileTabBar (§35 — mobile is a first-class product).
 * Fixed bottom navigation for <768px only; honors the home-indicator
 * safe area. Touch targets ≥44px. The full Sheet menu stays in the top
 * bar (hamburger) — this bar carries the five highest-frequency goals.
 */
export function MobileTabBar() {
  const loc = useRoute();
  const locale = (loc.locale as Locale) ?? "en";
  const { user } = useAuth();
  const accountTo = user ? "/account" : "/account/login";
  const onAccount = loc.path.startsWith("/account") && !loc.path.startsWith("/account/favorites");

  const tabs = [
    { to: "/", label: t("tabbar.explore", locale), icon: Compass, active: loc.path === "/" },
    {
      to: "/properties/map",
      label: t("tabbar.map", locale),
      icon: MapIcon,
      active: loc.path.startsWith("/properties/map"),
    },
    {
      to: "/account/favorites",
      label: t("tabbar.saved", locale),
      icon: Heart,
      active: loc.path.startsWith("/account/favorites"),
    },
    {
      to: "/advisor",
      label: t("tabbar.ai", locale),
      icon: Sparkles,
      active: loc.path.startsWith("/advisor"),
    },
    {
      to: accountTo,
      label: t("tabbar.account", locale),
      icon: User,
      active: onAccount,
    },
  ];

  return (
    <nav
      aria-label={t("tabbar.label", locale)}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid h-14 grid-cols-5">
        {tabs.map(({ to, label, icon: Icon, active }) => (
          <li key={to} className="flex">
            <Link
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-1 text-xs font-medium transition-ui",
                active ? "text-brand-strong" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && (
                <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand" />
              )}
              <Icon className="h-5 w-5" aria-hidden />
              <span className="leading-none">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

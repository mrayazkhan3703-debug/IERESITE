"use client";

import * as React from "react";
import { SiteHeader } from "@/components/layout/site-header";
import { CommandPalette } from "@/components/common/command-palette";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { CookieConsent } from "@/components/consent/cookie-consent";
import { QuickContactFab } from "@/components/common/quick-contact-fab";
import { AuthProvider } from "@/components/providers/auth-provider";
import { useRoute, type RouteLocation } from "@/lib/router";
import { events, getAttribution, flush } from "@/lib/analytics-tracker";
import { dir, t, type Locale } from "@/lib/i18n";

/** Compatibility inputs; native route modules now own the server SEO head. */
export interface RouteMetaInput {
  title?: string;
  description?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  localeAlternates?: { en: string; ar: string; "x-default": string } | null;
}

export function usePageMeta(meta: RouteMetaInput, deps: unknown[] = [], enabled = true) {
  const loc = useRoute();
  React.useEffect(() => {
    if (!enabled) return;
    const locale = (loc.locale as Locale) ?? "en";
    // Native route modules own title/canonical/robots/OG/hreflang, including
    // reviewed CMS overrides. Client DTO hydration must not rewrite that head.
    // JSON-LD structured data (only when content supports it — page contract)
    document.querySelectorAll('script[data-route-jsonld]').forEach((s) => s.remove());
    if (meta.jsonLd) {
      const items = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
      for (const obj of items) {
        const s = document.createElement("script");
        s.type = "application/ld+json";
        s.dataset.routeJsonld = "1";
        s.textContent = JSON.stringify(obj).replace(/</g, "\\u003c");
        document.head.appendChild(s);
      }
    }

    // html lang/dir for RTL
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
    return () => { document.querySelectorAll('script[data-route-jsonld]').forEach((script) => script.remove()); };
     
  }, [enabled, loc.rawPath, loc.locale, JSON.stringify(loc.query), ...deps]);
}

/** Track page views on route change */
function usePageViewTracking(resolve: (loc: RouteLocation) => { path: string; meta?: Record<string, unknown> }) {
  const loc = useRoute();
  const first = React.useRef(true);
  React.useEffect(() => {
    const { path, meta } = resolve(loc);
    if (first.current) {
      first.current = false;
      // ensure session attribution exists
      getAttribution();
    }
    events.pageView(path, meta);
     
  }, [loc.rawPath, loc.locale]);
}

export function AppShell({
  children,
  routeResolver,
}: {
  children: React.ReactNode;
  routeResolver?: (loc: RouteLocation) => { path: string; meta?: Record<string, unknown> };
}) {
  const shellLocale = (useRoute().locale as Locale) ?? "en";
  usePageViewTracking(
    routeResolver ?? ((loc) => ({ path: loc.path }))
  );

  // Flush analytics when leaving
  React.useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); flush(); };
  }, []);

  return (
    <AuthProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t("a11y.skipToMain", shellLocale)}
      </a>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
        >
          {children}
        </main>
        <SiteFooter />
      </div>
      <MobileTabBar />
      <QuickContactFab />
      <CookieConsent />
      <CommandPalette />
    </AuthProvider>
  );
}

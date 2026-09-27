"use client";

/**
 * Market navigation modes (U10 §19.1) — a single tablist shared by every market
 * page. Overview/Communities/Reports live on /market (?tab=), Transactions and
 * Rents are dedicated routes, Map links out to the property map. Keyboard
 * navigation follows the WAI-ARIA tabs pattern; each tab is a real link so the
 * URL always reflects the active section.
 */

import * as React from "react";
import { Link, useRoute, navigate } from "@/lib/router";
import { t, localeOf } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

export type MarketTab = "overview" | "communities" | "reports";

/** Resolve the active market tab from the route path + ?tab= query. */
export function activeMarketTab(path: string, query: Record<string, string>): "overview" | "transactions" | "rents" | "communities" | "reports" {
  if (path === "/market/transactions") return "transactions";
  if (path === "/market/rents") return "rents";
  const tab = query.tab;
  if (tab === "communities" || tab === "reports") return tab;
  return "overview";
}

export function MarketTabs() {
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const active = activeMarketTab(loc.path, loc.query);

  const tabs: { key: string; label: string; to: string; query?: Record<string, string>; external?: boolean }[] = [
    { key: "overview", label: t("market.tabs.overview", locale), to: "/market" },
    { key: "transactions", label: t("market.tabs.transactions", locale), to: "/market/transactions" },
    { key: "rents", label: t("market.tabs.rents", locale), to: "/market/rents" },
    { key: "communities", label: t("market.tabs.communities", locale), to: "/market", query: { tab: "communities" } },
    { key: "reports", label: t("market.tabs.reports", locale), to: "/market", query: { tab: "reports" } },
    { key: "map", label: t("market.tabs.map", locale), to: "/properties/map", external: true },
  ];

  return (
    <div className="border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <nav className="container-page" aria-label={t("market.tabs.label", locale)}>
        <ul role="tablist" className="-mb-px flex gap-1 overflow-x-safe">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            const content = (
              <>
                {tab.label}
                {tab.external && <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}
              </>
            );
            const base = cn(
              "whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-brand text-brand-strong"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            );
            return (
              <li key={tab.key} role="presentation">
                {tab.external ? (
                  <Link to={tab.to} className={cn(base, "inline-flex items-center gap-1.5")}>
                    {content}
                  </Link>
                ) : (
                  <Link
                    to={tab.to}
                    query={tab.query}
                    className={base}
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? "page" : undefined}
                    onClick={(e) => {
                      // Same-page tab switch: replace instead of push so tab hops
                      // don't flood history (Link already handles real navigation).
                      if (loc.path === "/market" && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                        e.preventDefault();
                        navigate(tab.to, tab.query, { replace: true });
                        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
                      }
                    }}
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

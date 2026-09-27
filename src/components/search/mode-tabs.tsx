"use client";

/**
 * Search mode tabs (V2 §12.1, U04) — Buy / Rent / Off-Plan / Projects.
 * ARIA tablist with full roving-keyboard support (←/→/Home/End); the active
 * mode persists to the URL (`?mode=rent|offplan|projects`, buy = absent).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";

export type SearchMode = "buy" | "rent" | "offplan" | "projects";

const MODE_KEYS: SearchMode[] = ["buy", "rent", "offplan", "projects"];

const I18N_KEY: Record<SearchMode, string> = {
  buy: "search.mode.buy",
  rent: "search.mode.rent",
  offplan: "search.mode.offplan",
  projects: "search.mode.projects",
};

export function modeLabel(mode: SearchMode, locale: Locale): string {
  return t(I18N_KEY[mode], locale);
}

export function SearchModeTabs({
  mode,
  onModeChange,
  locale,
  className,
  size = "md",
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  locale: Locale;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const moveFocus = (from: number, delta: 1 | -1) => {
    const next = (from + delta + MODE_KEYS.length) % MODE_KEYS.length;
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("search.mode.label", locale)}
      onKeyDown={(e) => {
        const idx = MODE_KEYS.indexOf(mode);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          moveFocus(idx, 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          moveFocus(idx, -1);
        } else if (e.key === "Home") {
          e.preventDefault();
          refs.current[0]?.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          refs.current[MODE_KEYS.length - 1]?.focus();
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-card p-1",
        className
      )}
    >
      {MODE_KEYS.map((m, i) => {
        const active = m === mode;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => !active && onModeChange(m)}
            className={cn(
              "rounded-full font-medium transition-ui",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              active
                ? "bg-brand text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            )}
          >
            {modeLabel(m, locale)}
          </button>
        );
      })}
    </div>
  );
}

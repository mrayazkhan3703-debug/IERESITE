"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * V3 §18 mobile disclosure — a 44px collapsible toggle below sm, while the
 * content stays always-visible from sm up (V2 layout preserved on desktop).
 * Progressive disclosure only where vertical space is scarce; the collapsed
 * affordance is keyboard-operable and announces state via aria-expanded.
 */
export function MobileDisclosure({
  label,
  children,
  className,
  contentClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/60 px-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-ui hover:border-brand/40 hover:text-foreground sm:hidden"
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn(!open && "hidden", "mt-1.5 sm:mt-0 sm:block", contentClassName)}>{children}</div>
    </div>
  );
}

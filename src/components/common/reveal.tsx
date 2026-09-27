"use client";

import * as React from "react";
import { useReveal } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

/**
 * V3 §17 section reveal wrapper. See src/hooks/use-reveal.ts for the full
 * motion contract (once, 240ms, opacity/transform only, reduced-motion and
 * no-JS safe, zero CLS). Wrap a whole homepage section; the plain <div>
 * carries no styling so section backgrounds/stripes stay adjacent.
 */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}

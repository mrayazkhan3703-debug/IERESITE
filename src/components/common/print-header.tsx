"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Print-only document header (visible only in print/PDF output).
 * Gives shared PDFs a branded masthead: company, document title,
 * canonical URL, print date — and the demo-data disclosure line
 * when the underlying record is fixture data (PART T governance).
 */
export function PrintHeader({
  title,
  url,
  isDemoData,
  note,
  className,
  origin = "https://ieresite.onrender.com",
}: {
  title: string;
  /** Canonical hash URL of the record, e.g. /#/properties/<slug> */
  url: string;
  isDemoData?: boolean;
  /** Optional advisory line (e.g. print-orientation hint) */
  note?: string;
  className?: string;
  /** Canonical public origin supplied by the server so hydration stays stable. */
  origin?: string;
}) {
  const printedAt = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date()),
    [],
  );
  return (
    <div className={cn("hidden print:block", className)} aria-hidden={true}>
      <div className="flex items-end justify-between border-b-2 border-ink pb-2">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight">Investment Experts</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Dubai Real Estate Investment Platform</p>
        </div>
        <p className="text-[10px] text-muted-foreground">Printed {printedAt}</p>
      </div>
      <p className="mt-1.5 text-xs font-semibold">{title}</p>
      <p className="num break-all text-[10px] text-muted-foreground">
        {origin}
        {url}
      </p>
      {isDemoData && (
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Illustrative demo data — not a live listing
        </p>
      )}
      {note && <p className="mt-0.5 text-[10px] italic text-muted-foreground">{note}</p>}
      <div className="mt-4" />
    </div>
  );
}

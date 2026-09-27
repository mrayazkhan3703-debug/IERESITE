"use client";

/**
 * Data-state presentation layer (V2 §5.1 + §37).
 *
 * - DataStateBadge: per-figure state chip with sr-only explanation (§37: a tiny
 *   badge is never the ONLY distinction — the description travels with it).
 * - DataStateNotice: page-level disclosure bar for demo/staging environments.
 * - UnavailableValue: honest missing-value cell ("Not provided"), never a
 *   bare "-" hyphen.
 *
 * Color semantics: verified/approved = success (green) family;
 * modeled/illustrative = brand bronze; stale/unavailable = warning amber;
 * user-input = neutral.
 */

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDataState, isDemoDataState, type MetricState } from "@/lib/data-state";

interface MetricStateStyle {
  className: string;
  label: string;
  description: string;
}

const METRIC_STATE_STYLES: Record<MetricState, MetricStateStyle> = {
  VERIFIED_SOURCE: {
    className: "border-success/40 bg-success/10 text-success",
    label: "Verified source",
    description: "Figure retrieved from a verified external source with a retrieval date.",
  },
  APPROVED_INTERNAL: {
    className: "border-success/40 bg-success/10 text-success",
    label: "Approved internal",
    description: "Internal figure approved through the production data pipeline.",
  },
  MODELED: {
    className: "border-brand/40 bg-brand-soft text-brand-strong",
    label: "Modeled",
    description: "Derived estimate — modeled from source data, not a directly observed value.",
  },
  USER_INPUT: {
    className: "border-border bg-secondary text-muted-foreground",
    label: "User input",
    description: "Value supplied by the user; not independently verified market data.",
  },
  ILLUSTRATIVE: {
    className: "border-brand/30 bg-brand-faint text-brand-strong",
    label: "Illustrative",
    description: "Illustrative figure for demonstration — not live market data.",
  },
  STALE: {
    className: "border-warning/40 bg-warning/10 text-warning",
    label: "Stale",
    description: "Source figure past its freshness window — treat as outdated until refreshed.",
  },
  UNAVAILABLE: {
    className: "border-warning/30 bg-warning/5 text-warning/80",
    label: "Unavailable",
    description: "No verified value available — intentionally not shown rather than fabricated.",
  },
};

/** Per-figure state chip. Always pairs the visible label with an sr-only description. */
export function DataStateBadge({ state, className }: { state: MetricState; className?: string }) {
  const s = METRIC_STATE_STYLES[state] ?? METRIC_STATE_STYLES.UNAVAILABLE;
  return (
    <span
      title={s.description}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.className,
        className
      )}
    >
      {s.label}
      <span className="sr-only"> — {s.description}</span>
    </span>
  );
}

/**
 * Page-level dataset disclosure. Renders ONLY in LOCAL_DEMO / STAGING_FIXTURE
 * environments; production modes render nothing (their figures carry per-row
 * DataStateBadge provenance instead).
 */
export function DataStateNotice({
  scope = "this page",
  className,
}: {
  scope?: string;
  className?: string;
}) {
  const state = getDataState();
  if (!isDemoDataState(state)) return null;
  const isLocal = state === "LOCAL_DEMO";
  return (
    <aside
      role="note"
      aria-label="Data environment disclosure"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3",
        className
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p className="text-sm leading-relaxed text-foreground/90">
        <span className="font-semibold">
          {isLocal ? "Local demo dataset" : "Staging fixture dataset"}
        </span>{" "}
        — figures on {scope} are for demonstration purposes only and do not represent real
        market data.{" "}
        <span className="text-muted-foreground">
          {isLocal
            ? "The production deployment swaps in the verified DLD open-data feed with per-figure provenance."
            : "Staging values are fixtures pending verification before production release."}
        </span>
      </p>
    </aside>
  );
}

/**
 * Honest missing-value cell. Replaces bare "-" placeholders: a value that the
 * source did not provide is labeled as such, never visually implied as zero.
 */
export function UnavailableValue({ label }: { label?: string }) {
  const phrase = label ? `${label} not provided` : "Not provided";
  return (
    <span
      title="Data not available from the current source"
      className="inline-flex items-center gap-1 text-xs italic text-muted-foreground"
    >
      {phrase}
      <span className="sr-only"> — data unavailable</span>
    </span>
  );
}

"use client";

/**
 * Categorical mix bars (U10 §19.4/§19.5) — property-type share and bedroom
 * share of the current filtered record set. Pure CSS bars with chart-theme
 * colors (no chart library needed for a single stacked proportion), plus an
 * sr-only table alternative for assistive technology.
 */

import * as React from "react";
import { chartColor } from "@/lib/chart-theme";
import { formatNumber, formatMoney } from "@/lib/money";
import { ChartCard } from "./chart-card";
import { SourceDialogButton } from "./source-dialog";
import type { SourceInfo } from "./market-types";

export interface MixDatum {
  label: string;
  count: number;
  medianMinor?: string | null;
}

export function MixBars({
  title,
  data,
  medianLabel,
  source,
}: {
  title: string;
  data: MixDatum[];
  medianLabel?: string;
  source: SourceInfo;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0 || data.length === 0) return null;

  return (
    <ChartCard
      title={title}
      description={`${formatNumber(total)} records · ${data.length} categories`}
      action={<SourceDialogButton info={source} />}
      askAiQuery={`Explain the ${title.toLowerCase()} mix for the current filter — which segment dominates and what does that signal?`}
      srSummary={`${title}: ${data.map((d) => `${d.label} ${d.count} records (${((d.count / total) * 100).toFixed(1)}%)`).join("; ")}.`}
    >
      {/* Stacked proportion bar */}
      <div
        className="flex h-7 w-full overflow-hidden rounded-lg border border-border/60"
        role="presentation"
        aria-hidden="true"
      >
        {data.map((d, i) => (
          <div
            key={d.label}
            className="h-full transition-all"
            style={{ width: `${(d.count / total) * 100}%`, backgroundColor: chartColor(i) }}
            title={`${d.label}: ${formatNumber(d.count)} (${((d.count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      {/* Per-row legend with counts + share */}
      <ul className="mt-4 space-y-2.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-3 text-sm">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: chartColor(i) }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{d.label}</span>
            {d.medianMinor && (
              <span className="num hidden text-xs text-muted-foreground sm:inline">
                {medianLabel ?? "median"} {formatMoney(d.medianMinor, { currency: "AED", compact: true })}
              </span>
            )}
            <span className="num shrink-0 text-xs text-muted-foreground">
              {formatNumber(d.count)} · {((d.count / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

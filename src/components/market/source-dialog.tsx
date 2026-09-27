"use client";

/**
 * Per-chart source affordance (V2 §19.4 → V3-G §28).
 *
 * Migrated to the shared EvidenceDrawer (bottom sheet <768px, side drawer
 * ≥768px): every chart's "Source" button now opens the standard evidence
 * record — data state, source, coverage window, sample size, exclusions
 * (as caveats) and methodology. Content contract unchanged from the V2
 * dialog; only the presentation container is new.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/money";
import { EvidenceDrawer, type EvidenceRecord } from "@/components/common/evidence-drawer";
import type { SourceInfo } from "./market-types";

const REASON_LABELS: Record<string, string> = {
  zero_bedrooms_non_studio: "zero-bedroom non-studio units",
  non_positive_rent: "non-positive annual rent",
  non_positive_amount: "non-positive amounts",
  missing_size: "missing area (excluded from per-sqft metrics only)",
  non_positive_size: "non-positive area (excluded from per-sqft metrics only)",
};

export function SourceDialogButton({ info, label = "Source" }: { info: SourceInfo; label?: string }) {
  /* Exclusions become the drawer's caveats block (same content as V2). */
  const caveats =
    info.exclusions && info.exclusions.excluded > 0
      ? `${formatNumber(info.exclusions.excluded)} records excluded as invalid — ` +
        Object.entries(info.exclusions.reasons)
          .filter(([, n]) => n > 0)
          .map(([key, n]) => `${formatNumber(n)} × ${REASON_LABELS[key] ?? key}`)
          .join(" · ")
      : null;

  const evidence: EvidenceRecord = {
    state: info.state ?? null,
    source: info.source,
    effectiveDate: info.coverage?.to ?? null,
    sampleSize: info.coverage?.records ?? null,
    methodology:
      (info.coverage
        ? `Coverage ${info.coverage.from ? formatDate(info.coverage.from) : "—"} → ${info.coverage.to ? formatDate(info.coverage.to) : "—"} over ${formatNumber(info.coverage.records)} validated records.`
        : null) +
      (info.methodology ? (info.coverage ? " " : "") + info.methodology : ""),
    caveats,
  };

  return (
    <EvidenceDrawer
      title={`${info.title} — source`}
      description="Where these numbers come from, what they cover and what was excluded."
      evidence={evidence}
      surface={`market_chart:${info.title}`}
      triggerLabel={label}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:h-7"
          aria-label={`Open the data source and methodology for ${info.title}`}
        >
          <Database className="h-3.5 w-3.5" aria-hidden /> {label}
        </Button>
      }
    />
  );
}

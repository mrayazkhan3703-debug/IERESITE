"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, Inbox } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { PriceDTO, ProvenanceChip } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Breadcrumbs ---------------------------------------------------------- */

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-sm print:hidden", className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />}
              {item.to && !last ? (
                <Link to={item.to} className="transition-ui hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-foreground" : ""}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* State components (loading/empty/error) — page contract requirement ------ */

export function LoadingState({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" style={{ opacity: 1 - i * 0.2 }} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="space-y-3 overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="skeleton-shimmer aspect-[4/3] w-full" />
      <div className="space-y-2 p-4">
        <div className="skeleton-shimmer h-4 w-3/4 rounded-sm" />
        <div className="skeleton-shimmer h-4 w-1/2 rounded-sm" />
        <div className="skeleton-shimmer h-6 w-1/3 rounded-sm" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-sand/40 px-6 py-16 text-center">
      <div className="mb-3 rounded-full bg-brand-soft p-3.5 text-brand-strong">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <Button size="default" className="mt-5 rounded-full" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <AlertCircle className="mb-3 h-9 w-9 text-destructive" aria-hidden />
      <h3 className="font-display text-lg font-semibold">{message}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This may be temporary. Your data is safe.
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* Price display ---------------------------------------------------------- */

export function Price({
  price,
  className,
  compact,
  showQualifier = true,
}: {
  price: PriceDTO;
  className?: string;
  compact?: boolean;
  showQualifier?: boolean;
}) {
  return (
    <span className={cn("num font-semibold text-ink", className)}>
      {showQualifier && price.qualifier ? `${price.qualifier} ` : ""}
      {formatMoney(price.minor, { currency: price.currency, compact })}
      {price.rentFrequency === "YEARLY" && <span className="ml-0.5 text-xs font-normal text-muted-foreground">/yr</span>}
      {price.rentFrequency === "MONTHLY" && <span className="ml-0.5 text-xs font-normal text-muted-foreground">/mo</span>}
      {price.rentFrequency === "DAILY" && <span className="ml-0.5 text-xs font-normal text-muted-foreground">/night</span>}
    </span>
  );
}

/* Provenance chip — the "Investment Evidence Layer" ------------------------ */

export function ProvenanceBadge({ chip }: { chip: ProvenanceChip }) {
  if (chip.isDemoData) {
    return (
      <span
        title="Development fixture data — replace with production feed"
        className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
      >
        Demo data
      </span>
    );
  }
  if (chip.isIllustrative) {
    return (
      <span
        title="Illustrative figure — not live market data"
        className="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info"
      >
        Illustrative
      </span>
    );
  }
  const verified = chip.sourceType === "VERIFIED" || chip.verifiedAt;
  return (
    <span
      title={`${chip.sourceName ?? chip.sourceType}${chip.verifiedAt ? ` · verified ${new Date(chip.verifiedAt).toLocaleDateString()}` : ""}`}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {verified ? "Verified source" : "Source"} {chip.sourceName ? `· ${chip.sourceName}` : ""}
    </span>
  );
}

/* Section heading ---------------------------------------------------------- */

export function SectionHeading({
  kicker,
  title,
  description,
  action,
  as: Tag = "h2",
  id,
}: {
  kicker?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  id?: string;
}) {
  return (
    <div id={id} className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {kicker && <p className="kicker mb-2">{kicker}</p>}
        <Tag className={cn("font-display font-semibold tracking-tight text-ink", Tag === "h1" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl")}>
          {title}
        </Tag>
        {description && <p className="mt-2 text-balance text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* Availability/status badges ------------------------------------------------ */

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: "border-success/40 bg-success/10 text-success",
  RESERVED: "border-warning/40 bg-warning/10 text-warning",
  SOLD: "border-destructive/40 bg-destructive/10 text-destructive",
  RENTED: "border-destructive/40 bg-destructive/10 text-destructive",
  HELD: "border-warning/40 bg-warning/10 text-warning",
  WITHDRAWN: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[status] ?? STATUS_STYLES.WITHDRAWN,
        className
      )}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

/* Print-only document header ------------------------------------------------ */

export { PrintHeader } from "@/components/common/print-header";

/* Data-state presentation (V2 §5.1/§37) ------------------------------------- */

export {
  DataStateBadge,
  DataStateNotice,
  UnavailableValue,
} from "@/components/common/data-state";

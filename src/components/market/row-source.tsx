import type { MarketRow } from "./market-types";
export function MarketRowSource({ row }: { row: MarketRow }) {
  if (!row.provenance) return null;
  return <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{row.source} · {row.provenance.freshness}</summary><p className="mt-1">Source retrieved {row.provenance.retrievedAt?.slice(0, 10) ?? "unknown"} · editorial review recorded; no independent certification.</p>{row.provenance.sourceUrl && <a href={row.provenance.sourceUrl} target="_blank" rel="noreferrer" className="underline">Publisher source</a>}</details>;
}

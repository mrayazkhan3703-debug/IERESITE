"use client";
import * as React from "react";
import { api } from "@/lib/api-client";
import type { MarketReportEmbed } from "@/lib/market-report-embeds";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
interface Data { dataState?: string; total?: number; agg?: { count: number; illustrativeCount?: number; sourcedCount?: number; medianAmountMinor?: string | null; medianRentMinor?: string | null }; metrics?: { id: string; metricKey: string; valueNumeric: number; unit: string; periodStart: string; isIllustrative: boolean; sourceName: string }[] }
export function ReportDataEmbed({ embed }: { embed: MarketReportEmbed }) {
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    const abort = new AbortController(); setData(null); setError(false);
    api.get<Data>(`/api/market/${embed.kind}?pageSize=5${embed.community ? `&community=${encodeURIComponent(embed.community)}` : ""}`, abort.signal).then(setData).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [embed.kind, embed.community, retry]);
  const median = data?.agg?.medianAmountMinor ?? data?.agg?.medianRentMinor;
  return <section className="not-prose my-6 rounded-xl border border-border/70 bg-card p-5" aria-label={`Report ${embed.kind} data`}>
    <p className="kicker">Current recorded data · {embed.kind}</p><p className="mt-1 text-xs text-muted-foreground">Live explorer view{embed.community ? ` · ${embed.community}` : ""}. Values can change after publication; see the explorer for source, date range and exclusions.</p>
    {data && <p className="mt-2 text-xs font-medium">{data.dataState === "LOCAL_DEMO" || data.dataState === "STAGING_FIXTURE" ? "Demonstration environment. " : ""}{embed.kind !== "metrics" && ((data.agg?.illustrativeCount ?? 0) > 0 ? `${data.agg!.illustrativeCount} illustrative observations included; this summary is not verified market evidence.` : "Source-labelled observations; source authenticity requires editorial review.")}</p>}
    {error ? <div role="alert" className="mt-3"><p className="text-sm">Market data is temporarily unavailable.</p><Button variant="outline" size="sm" onClick={() => setRetry((r) => r + 1)}>Retry report data</Button></div> : !data ? <p className="mt-3 text-sm" role="status">Loading recorded data…</p> : embed.kind === "metrics" ? <div className="mt-4 space-y-2">{!data.metrics?.length && <p className="text-sm text-muted-foreground">No published source metrics for this scope.</p>}{data.metrics?.slice(0, 6).map((m) => <div key={m.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{m.metricKey.replaceAll("_", " ")} · {m.periodStart.slice(0, 7)}</span><strong>{m.valueNumeric.toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.unit}</strong><span className="w-full text-xs text-muted-foreground">{m.isIllustrative ? "Illustrative" : "Computed / source-labelled"} · {m.sourceName}</span></div>)}</div> : <div className="mt-4 flex flex-wrap gap-8"><div><p className="text-xs text-muted-foreground">Eligible observations</p><strong className="font-display text-2xl">{data.total?.toLocaleString() ?? "—"}</strong></div><div><p className="text-xs text-muted-foreground">Median {embed.kind === "rents" ? "annual rent" : "recorded price"}</p><strong className="font-display text-2xl">{median ? `AED ${(Number(median) / 100).toLocaleString()}` : "Unavailable"}</strong></div></div>}
    <Link to={embed.kind === "metrics" ? "/market" : `/market/${embed.kind}`} query={embed.community ? { community: embed.community } : {}} className="mt-4 inline-block text-sm underline underline-offset-4">Explore the source data</Link>
  </section>;
}

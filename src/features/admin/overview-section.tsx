"use client";
import * as React from "react";
import { api } from "@/lib/api-client";
import { ErrorState, LoadingState, StatusBadge } from "@/components/common";
import { formatNumber } from "@/lib/money";

export function OverviewSection() {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.get<Record<string, unknown> | null>("/api/admin/overview").then(setData).catch(() => setError("Overview unavailable"));
  }, []);
  if (error) return <ErrorState message={error} onRetry={() => location.reload()} />;
  if (!data) return <LoadingState rows={4} />;
  const k = data.kpis as Record<string, number>;
  const crm = data.crm as Record<string, number | string>;
  const recentLeads = (data.recentLeads as Record<string, string>[] | undefined) ?? [];
  const cards = [
    { label: "Leads (total)", value: formatNumber(k.leadsTotal), sub: `${formatNumber(k.leadsNew)} new · ${formatNumber(k.leadsThisWeek)} this week` },
    { label: "Published properties", value: formatNumber(k.propertiesPublished), sub: `${formatNumber(k.propertiesDraft)} drafts` },
    { label: "Projects", value: formatNumber(k.projectsCount), sub: "published" },
    { label: "Open quality issues", value: formatNumber(k.openQualityIssues), sub: "needs review" },
    { label: "Outbox pending", value: formatNumber(k.outboxPending), sub: "events to drain" },
    { label: "Dead letters", value: formatNumber(k.dlqCount), sub: "needs replay" },
    { label: "AI usage", value: `${formatNumber(k.aiCalls ?? 0)} calls`, sub: `${formatNumber(Math.round((k.aiCostMicros ?? 0) / 100) / 10000)} indicative cost units` },
    { label: "Registered users", value: formatNumber(k.activeUsers), sub: "accounts" },
  ];
  return <div className="space-y-8">
    <header><h1 className="font-display text-2xl font-semibold">Operations overview</h1><p className="mt-1 text-sm text-muted-foreground">Platform health, pipeline and business KPIs (Q33 observability).</p></header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <div key={card.label} className="rounded-xl border border-border/70 bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p><p className="num mt-1.5 font-display text-2xl font-semibold">{card.value}</p><p className="mt-0.5 text-xs text-muted-foreground">{card.sub}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border/70 bg-card p-5"><h2 className="kicker mb-3">CRM pipeline</h2><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">{[["Total leads", crm.totalLeads], ["Delivered", crm.delivered], ["Pending / retrying", crm.pending], ["Dead", crm.dead], ["Unreconciled", crm.unreconciled], ["Provider", crm.provider]].map(([label, value]) => <div key={String(label)} className="flex items-baseline justify-between border-b border-border/40 pb-1.5"><span className="text-muted-foreground">{String(label)}</span><span className="num font-semibold">{String(value)}</span></div>)}</div><p className="mt-3 text-xs text-muted-foreground">Local adapter remains the default; live provider readiness must be verified separately.</p></div>
      <div className="rounded-xl border border-border/70 bg-card p-5"><h2 className="kicker mb-3">Recent leads</h2><div className="space-y-2">{recentLeads.map((lead) => <div key={lead.id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 text-sm last:border-0"><div className="min-w-0"><p className="truncate font-medium">{lead.contactName ?? "—"} <span className="text-xs text-muted-foreground">· {lead.intent}</span></p><p className="truncate text-xs text-muted-foreground">{lead.contactEmail ?? lead.contactPhone ?? ""}</p></div><div className="shrink-0 text-right"><StatusBadge status={lead.status} /><p className="mt-0.5 text-[10px] text-muted-foreground">{lead.ownerAgent ?? "unassigned"}</p></div></div>)}{recentLeads.length === 0 && <p className="text-sm text-muted-foreground">No leads yet — submit an enquiry on the public site.</p>}</div></div>
    </div>
  </div>;
}

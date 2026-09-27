import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { leadAggregateScope } from "@/server/domain/resource-policy";

export const dynamic = "force-dynamic";

/** Analytics rollups (Q34): event taxonomy counts + funnel + attribution */
export const GET = apiHandler(async () => {
  const user = await requirePermission("analytics:read");

  const since = new Date(Date.now() - 30 * 86400_000);
  const leadScope = leadAggregateScope(user);
  const [byName, byDay, leadsBySource, leadsByIntent, topSearches, attribution] = await Promise.all([
    db.analyticsEvent.groupBy({ by: ["name"], where: { createdAt: { gte: since } }, _count: true, orderBy: { _count: { name: "desc" } } }),
    db.analyticsEvent.groupBy({ by: ["createdAt"], where: { name: "page_view", createdAt: { gte: since } }, _count: true, orderBy: { createdAt: "asc" } }),
    db.lead.groupBy({ by: ["sourceChannel"], where: leadScope, _count: true }),
    db.lead.groupBy({ by: ["intent"], where: leadScope, _count: true }),
    db.searchQuery.groupBy({ by: ["normalizedText"], where: { normalizedText: { not: "" } }, _count: true, orderBy: { _count: { normalizedText: "desc" } }, take: 10 }),
    db.leadContext.groupBy({ by: ["utmSource"], where: { lead: { is: leadScope } }, _count: true }),
  ]);

  return NextResponse.json({
    window: "30d",
    byName: byName.map((e) => ({ name: e.name, count: e._count })),
    pageViewsByDay: byDay.map((d) => ({ day: d.createdAt.toISOString().slice(0, 10), count: d._count })),
    leadsBySource: leadsBySource.map((s) => ({ source: s.sourceChannel, count: s._count })),
    leadsByIntent: leadsByIntent.map((s) => ({ intent: s.intent, count: s._count })),
    topSearches: topSearches.map((s) => ({ query: s.normalizedText, count: s._count })),
    attribution: attribution.map((a) => ({ utmSource: a.utmSource ?? "(direct)", count: a._count })),
  });
});

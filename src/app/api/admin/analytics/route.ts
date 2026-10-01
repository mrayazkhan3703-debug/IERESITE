import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { leadAggregateScope } from "@/server/domain/resource-policy";
export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const user = await requirePermission("analytics:read");
  const measuredAt = new Date(), since = new Date(measuredAt.getTime() - 30 * 86400_000);
  const createdAt = { gte: since, lte: measuredAt }, leadScope = { AND: [leadAggregateScope(user), { createdAt }] };
  const [byName, byDay, leadsBySource, leadsByIntent, topSearches, attribution, events, leads, searches] = await db.$transaction([
    db.analyticsEvent.groupBy({ by: ["name"], where: { createdAt }, _count: true, orderBy: { _count: { name: "desc" } }, take: 101 }),
    db.$queryRaw<{ day: string; count: bigint }[]>`SELECT to_char(timezone('UTC', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS count FROM "AnalyticsEvent" WHERE "name" = 'page_view' AND "createdAt" >= ${since} AND "createdAt" <= ${measuredAt} GROUP BY 1 ORDER BY 1`,
    db.lead.groupBy({ by: ["sourceChannel"], where: leadScope, _count: true, orderBy: { sourceChannel: "asc" } }),
    db.lead.groupBy({ by: ["intent"], where: leadScope, _count: true, orderBy: { intent: "asc" } }),
    db.searchQuery.groupBy({ by: ["normalizedText"], where: { normalizedText: { not: "" }, createdAt }, _count: true, orderBy: { _count: { normalizedText: "desc" } }, take: 10 }),
    db.leadContext.groupBy({ by: ["utmSource"], where: { lead: { is: leadScope } }, _count: true, orderBy: { _count: { utmSource: "desc" } }, take: 101 }),
    db.analyticsEvent.aggregate({ where: { createdAt }, _count: true, _max: { createdAt: true } }),
    db.lead.count({ where: leadScope }),
    db.searchQuery.count({ where: { normalizedText: { not: "" }, createdAt } }),
  ], { isolationLevel: "RepeatableRead" });
  return NextResponse.json({
    window: "30d", windowStart: since.toISOString(), measuredAt: measuredAt.toISOString(), timezone: "UTC",
    status: events._count || leads || searches ? "RECORDED_DATA" : "NO_RECORDED_DATA", latestEventAt: events._max.createdAt?.toISOString() ?? null,
    totals: { events: events._count, leads, searches }, truncated: { eventNames: byName.length > 100, attribution: attribution.length > 100 },
    scope: { events: "site", searches: "site", leads: user.roles.includes("OWNER") ? "all organizations" : "your organization" },
    note: "Recorded events depend on consent and successful delivery; they are not total visits or unique visitors. Lead attribution may be unknown. These counts do not measure CRM delivery or revenue.",
    byName: byName.slice(0, 100).map((event) => ({ name: event.name, count: event._count })),
    pageViewsByDay: byDay.map((day) => ({ day: day.day, count: Number(day.count) })),
    leadsBySource: leadsBySource.map((source) => ({ source: source.sourceChannel, count: source._count })),
    leadsByIntent: leadsByIntent.map((intent) => ({ intent: intent.intent, count: intent._count })),
    topSearches: topSearches.map((search) => ({ query: search.normalizedText, count: search._count })),
    attribution: attribution.slice(0, 100).map((item) => ({ utmSource: item.utmSource ?? "(unknown)", count: item._count })),
  }, { headers: { "Cache-Control": "private, no-store" } });
});

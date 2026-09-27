import { NextResponse } from "next/server";
import { listAgents, getAgentDetailV2 } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { PUBLIC_COMMUNITY_WHERE } from "@/server/domain/visibility";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const detail = await getAgentDetailV2(slug);
    if (!detail) return NextResponse.json({ error: "Advisor not found", status: 404 }, { status: 404 });
    return NextResponse.json(detail);
  }

  /* U08 (§18): community expertise filter — additive. `community` accepts a
   * community slug; agents match via the AgentCommunity join table OR the
   * communitiesJson mirror (union, no behavior change when omitted). */
  const community = url.searchParams.get("community");
  const agents = await listAgents();

  // This unauthenticated endpoint always returns the explicit public roster.
  const roster = agents;

  if (!community) return NextResponse.json({ agents: roster });

  const communityRow = await db.community.findFirst({
    where: { slug: community, ...PUBLIC_COMMUNITY_WHERE },
    select: { id: true, name: true, slug: true },
  });
  const joined = communityRow
    ? await db.agentCommunity.findMany({ where: { communityId: communityRow.id }, select: { agentId: true } })
    : [];
  const joinedIds = new Set(joined.map((j) => j.agentId));
  const filtered = roster.filter(
    (a) => joinedIds.has(a.id) || a.communities.some((c) => c.slug === community || c.id === community)
  );
  return NextResponse.json({ agents: filtered, community: communityRow ?? null });
});

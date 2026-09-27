import { NextResponse } from "next/server";
import { listCommunities, getCommunityDetail } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const detail = await getCommunityDetail(slug);
    if (!detail) return NextResponse.json({ error: "Community not found" }, { status: 404 });
    return NextResponse.json(detail);
  }
  return NextResponse.json({ communities: await listCommunities() });
});

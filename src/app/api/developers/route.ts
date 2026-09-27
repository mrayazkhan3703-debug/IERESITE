import { NextResponse } from "next/server";
import { listDevelopers, getDeveloperDetail } from "@/server/domain/read-models";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const detail = await getDeveloperDetail(slug);
    if (!detail) return NextResponse.json({ error: "Developer not found" }, { status: 404 });
    return NextResponse.json(detail);
  }
  return NextResponse.json({ developers: await listDevelopers() });
});

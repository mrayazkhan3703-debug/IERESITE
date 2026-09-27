import { NextResponse } from "next/server";
import { autocomplete } from "@/server/search/service";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 100);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 8) || 8, 12);
  if (!q.trim()) return NextResponse.json({ items: [] });
  const items = await autocomplete(q, limit);
  return NextResponse.json({ items });
});

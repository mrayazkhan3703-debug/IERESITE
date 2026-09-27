import { NextResponse } from "next/server";
import { lookupRedirect } from "@/server/seo/sitemap";
import { apiHandler } from "@/server/api-handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return NextResponse.json({ to: null });
  const redirect = await lookupRedirect(path.startsWith("/") ? path : `/${path}`);
  return NextResponse.json({ to: redirect?.to ?? null, statusCode: redirect?.statusCode ?? null });
});

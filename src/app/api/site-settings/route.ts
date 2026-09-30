import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { readSiteSettings } from "@/server/domain/site-settings-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => NextResponse.json(await readSiteSettings(), {
  headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
}));

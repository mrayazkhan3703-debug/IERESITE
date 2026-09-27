import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { apiHandler } from "@/server/api-handler";
import { requireGhlAdmin } from "@/server/crm/ghl-oauth-admin";
import { ghlOAuthSettings } from "@/server/crm/ghl-oauth-config";
import { beginGhlOAuth, PrismaGhlOAuthStateStore } from "@/server/crm/ghl-oauth";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async () => {
  const actor = await requireGhlAdmin();
  const settings = ghlOAuthSettings(getConfig());
  const result = await beginGhlOAuth(new PrismaGhlOAuthStateStore(), actor, {
    installUrl: settings.installUrl,
    redirectUri: settings.redirectUri,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}, { rateLimit: { limit: 5, windowMs: 60_000, key: "ghl-oauth-start" } });

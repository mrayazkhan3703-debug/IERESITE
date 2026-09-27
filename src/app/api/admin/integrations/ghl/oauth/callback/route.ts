import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-handler";
import { audit } from "@/server/auth";
import { createGhlAccessTokenProvider } from "@/server/crm/ghl-client";
import { PrismaGhlTokenStore } from "@/server/crm/ghl-token-store";
import { requireGhlAdmin } from "@/server/crm/ghl-oauth-admin";
import { ghlOAuthSettings } from "@/server/crm/ghl-oauth-config";
import { completeGhlOAuthCallback, PrismaGhlOAuthStateStore } from "@/server/crm/ghl-oauth";

export const dynamic = "force-dynamic";

function returnToAdmin(config: ReturnType<typeof getConfig>, result: "connected" | "cancelled" | "failed") {
  const target = new URL("/admin", config.APP_URL);
  target.searchParams.set("section", "crm");
  target.searchParams.set("ghl", result);
  return NextResponse.redirect(target, 303);
}

export const GET = apiHandler(async (request) => {
  const actor = await requireGhlAdmin();
  const config = getConfig();
  const settings = ghlOAuthSettings(config);
  const query = new URL(request.url).searchParams;

  try {
    const result = await completeGhlOAuthCallback(
      new PrismaGhlOAuthStateStore(),
      actor,
      {
        state: query.get("state"),
        code: query.get("code"),
        providerError: query.get("error"),
      },
      async (code, redirectUri) => {
        const store = new PrismaGhlTokenStore(settings.locationId, settings.tokenEncryptionKey);
        const tokens = createGhlAccessTokenProvider({
          clientId: settings.clientId,
          clientSecret: settings.clientSecret,
          expectedLocationId: settings.locationId,
          store,
        });
        await tokens.exchangeAuthorizationCode(code, redirectUri);
      },
    );

    if (result.status === "connected") {
      await db.$transaction(async (tx) => {
        await tx.integrationConnection.upsert({
          where: { providerKey: "crm" },
          create: {
            providerKey: "crm",
            displayName: "GoHighLevel CRM",
            status: "CONFIGURED",
            configJson: JSON.stringify({ provider: "ghl", locationId: settings.locationId, deliveryEnabled: config.CRM_PROVIDER === "ghl" && config.CRM_LIVE_ENABLED }),
          },
          update: {
            displayName: "GoHighLevel CRM",
            status: "CONFIGURED",
            lastError: null,
            configJson: JSON.stringify({ provider: "ghl", locationId: settings.locationId, deliveryEnabled: config.CRM_PROVIDER === "ghl" && config.CRM_LIVE_ENABLED }),
          },
        });
        await audit({
          actorId: actor.id,
          action: "ghl.oauth.connected",
          resourceType: "integration",
          resourceId: settings.locationId,
          after: { status: "CONFIGURED", deliveryEnabled: config.CRM_PROVIDER === "ghl" && config.CRM_LIVE_ENABLED },
        }, tx);
      });
      return returnToAdmin(config, "connected");
    }
    return returnToAdmin(config, result.status === "cancelled" ? "cancelled" : "failed");
  } catch {
    // OAuth codes, provider error descriptions, and token response bodies are never echoed or logged.
    return returnToAdmin(config, "failed");
  }
}, { rateLimit: { limit: 10, windowMs: 60_000, key: "ghl-oauth-callback" } });

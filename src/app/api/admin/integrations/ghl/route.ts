import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-handler";
import { audit } from "@/server/auth";
import { getConfig } from "@/lib/config";
import { requireGhlAdmin } from "@/server/crm/ghl-oauth-admin";

export const dynamic = "force-dynamic";

export const DELETE = apiHandler(async () => {
  const actor = await requireGhlAdmin();
  const locationId = getConfig().GHL_LOCATION_ID?.trim();
  if (!locationId) return NextResponse.json({ error: "GHL location is not configured.", code: "GHL_NOT_CONFIGURED" }, { status: 409 });

  const removed = await db.$transaction(async (tx) => {
    const credential = await tx.ghlOAuthCredential.deleteMany({ where: { locationId } });
    // This is a single-location integration; invalidate every outstanding installation attempt.
    await tx.ghlOAuthState.deleteMany({});
    await tx.integrationConnection.updateMany({
      where: { providerKey: "crm" },
      data: {
        status: "NOT_CONFIGURED",
        lastError: null,
        configJson: JSON.stringify({ provider: "ghl", locationId, deliveryEnabled: false }),
      },
    });
    await audit({
      actorId: actor.id,
      action: "ghl.oauth.local_disconnect",
      resourceType: "integration",
      resourceId: locationId,
      after: { localCredentialRemoved: credential.count === 1 },
    }, tx);
    return credential.count;
  });

  return NextResponse.json({ ok: true, localCredentialRemoved: removed === 1, providerAuthorizationRevoked: false });
}, { rateLimit: { limit: 3, windowMs: 60_000, key: "ghl-oauth-disconnect" } });

import { externalCrmDeferred } from "@/server/crm/deferral";
import { z } from "zod";
import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db, parseJson } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { crmReconciliation } from "@/server/crm/adapter";
import { ghlOAuthSettings } from "@/server/crm/ghl-oauth-config";

export const dynamic = "force-dynamic";

/** CRM sync monitoring + reconciliation (Q16) */
export const GET = apiHandler(async (req) => {
  const user = await requirePermission("integration:read");
  const config = getConfig();
  const url = new URL(req.url);
  const page = z.coerce.number().int().min(1).max(100000).parse(url.searchParams.get("page") ?? 1);

  const [records, reconciliation, connections, credential] = await Promise.all([
    db.crmSyncRecord.findMany({
      where: user.roles.includes("OWNER") ? {} : { organizationId: user.organizationId ?? "__no_organization__" },
      orderBy: { createdAt: "desc" },
      take: 20,
      skip: (page - 1) * 20,
      include: { lead: { include: { contact: { select: { name: true } } } } },
    }),
    crmReconciliation(user.roles.includes("OWNER") ? undefined : user.organizationId),
    db.integrationConnection.findMany({ select: { providerKey: true, displayName: true, status: true, lastCheckedAt: true } }),
    config.GHL_LOCATION_ID ? db.ghlOAuthCredential.findUnique({ where: { locationId: config.GHL_LOCATION_ID.trim() }, select: { updatedAt: true } }) : null,
  ]);
  let oauthReady = true;
  try { ghlOAuthSettings(config); } catch { oauthReady = false; }

  return NextResponse.json({
    syncStatus: externalCrmDeferred(config) ? "DEFERRED" : "UNVERIFIED",
    deferredReason: externalCrmDeferred(config) ? "External synchronization is deferred. Local leads and pending records are retained." : null,
    reconciliation,
    connections,
    ghl: {
      connected: credential !== null,
      oauthReady,
      liveDeliveryEnabled: config.CRM_PROVIDER === "ghl" && !externalCrmDeferred(config),
      locationConfigured: Boolean(config.GHL_LOCATION_ID?.trim()),
      connectedAt: credential?.updatedAt.toISOString() ?? null,
    },
    records: records.map((r) => ({
      id: r.id,
      leadReference: r.leadId.slice(-8).toUpperCase(),
      contactName: r.lead.contact.name,
      provider: r.provider,
      status: r.status,
      effectiveStatus: externalCrmDeferred(config) && r.status !== "DELIVERED" ? "DEFERRED" : r.status,
      attempts: r.attempts,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      externalId: r.externalId,
      lastError: r.lastError,
      payload: parseJson<Record<string, unknown>>(r.payloadJson, {}),
    })),
  });
});

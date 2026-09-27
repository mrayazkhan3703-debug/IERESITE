/**
 * CRM integration adapter (Q16, blueprint PART E). Live credentials unavailable
 * → BLOCKED_LIVE_CRM_CREDENTIALS. The adapter boundary, retry/DLQ/reconciliation
 * and a local dev adapter (persisting full payload evidence) are complete.
 */
import { db, parseJson, toJsonValue } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { GhlCrmAdapter, mapIereLeadStatusToGhl, type GhlOpportunityStatus } from "@/server/crm/ghl-adapter";
import { createGhlAccessTokenProvider, GhlHttpClient } from "@/server/crm/ghl-client";
import { GHL_AGENT_MAPPING_KIND, GHL_AGENT_MAPPING_PROVIDER, verifiedGhlAgentId } from "@/server/crm/ghl-agent-mapping";
import { PrismaGhlTokenStore } from "@/server/crm/ghl-token-store";
import { logEvent } from "@/server/rate-limit";

export interface CrmLeadPayload {
  leadId: string;
  reference: string;
  intent: string;
  status: string;
  sourceChannel: string;
  contact: {
    name: string | null;
    email: string | null;
    phoneE164: string | null;
    dedupeKey: string;
  };
  message: string | null;
  entity: {
    type: string | null;
    id: string | null;
    slug: string | null;
    title: string | null;
  };
  attribution: {
    landingUrl: string | null;
    referrer: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    /* U20 (§40) additive: the full attribution set captured in lead_context —
     * utmContent/utmTerm carry comparison/campaign-content context,
     * pagePath records the originating surface, aiConversationId links the
     * AI-advisor handoff summary. Optional keys keep older payloads valid. */
    utmContent?: string | null;
    utmTerm?: string | null;
    pagePath?: string | null;
    aiConversationId?: string | null;
    locale: string;
    deviceClass: string | null;
  };
  assignment: {
    ownerAgentId: string | null;
    ownerAgentName: string | null;
    reason: string | null;
  };
  consent: {
    contact: boolean;
    marketing: boolean;
    policyVersion: string;
  };
  submittedAt: string;
}

export interface CrmAdapter {
  readonly provider: string;
  deliver(payload: CrmLeadPayload, idempotencyKey: string, signal?: AbortSignal): Promise<{ externalId: string | null; response: unknown }>;
}

/* Local development adapter — persists the exact payload + delivery evidence */
class LocalDevCrmAdapter implements CrmAdapter {
  readonly provider = "localdev";
  async deliver(payload: CrmLeadPayload, idempotencyKey: string, _signal?: AbortSignal): Promise<{ externalId: string | null; response: unknown }> {
    const existing = await db.crmSyncRecord.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "DELIVERED") {
      return { externalId: existing.externalId, response: parseJson(existing.responseJson, {}) };
    }
    // simulate provider acceptance with a deterministic external id
    const externalId = `LOCAL-${payload.leadId.slice(-8).toUpperCase()}`;
    const response = {
      ok: true,
      provider: "localdev",
      receivedAt: new Date().toISOString(),
      contactMatched: payload.contact.dedupeKey,
      externalId,
    };
    logEvent("crm.delivered_localdev", { leadId: payload.leadId, externalId });
    return { externalId, response };
  }
}

/* Production adapter stubs — activated by env credentials only */

class HubSpotCrmAdapter implements CrmAdapter {
  readonly provider = "hubspot";
  async deliver(payload: CrmLeadPayload, idempotencyKey: string, signal?: AbortSignal): Promise<{ externalId: string | null; response: unknown }> {
    const config = getConfig();
    if (!config.CRM_API_URL || !config.CRM_API_KEY) {
      throw new Error("HubSpot credentials not configured (BLOCKED_LIVE_CRM_CREDENTIALS)");
    }
    const res = await fetch(`${config.CRM_API_URL}/crm/v3/objects/deals`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.CRM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        properties: {
          dealname: `Lead ${payload.reference} — ${payload.entity.title ?? payload.intent}`,
          pipeline: "default",
          dealstage: "appointmentscheduled",
          hs_lead_status: "NEW",
          ie_lead_id: payload.leadId,
          ie_idempotency_key: idempotencyKey,
          ie_intent: payload.intent,
          ie_source_channel: payload.sourceChannel,
          ie_entity_type: payload.entity.type ?? "",
          ie_entity_title: payload.entity.title ?? "",
          ie_utm_source: payload.attribution.utmSource ?? "",
          ie_utm_campaign: payload.attribution.utmCampaign ?? "",
          ie_utm_content: payload.attribution.utmContent ?? "",
          ie_page_path: payload.attribution.pagePath ?? "",
          ie_ai_conversation_id: payload.attribution.aiConversationId ?? "",
          ie_landing_url: payload.attribution.landingUrl ?? "",
          ie_agent: payload.assignment.ownerAgentName ?? "",
          ie_consent_contact: String(payload.consent.contact),
          ie_consent_marketing: String(payload.consent.marketing),
        },
      }),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(20_000), signal])
        : AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HubSpot API ${res.status}`);
    const json = (await res.json()) as { id?: string };
    return { externalId: json.id ?? null, response: json };
  }
}

function getAdapter(): CrmAdapter {
  const config = getConfig();
  const provider = config.CRM_PROVIDER;
  switch (provider) {
    case "ghl": {
      if (!config.CRM_LIVE_ENABLED) throw new Error("GHL delivery is disabled (set CRM_LIVE_ENABLED=true only after verified setup)");
      const required = [config.GHL_CLIENT_ID, config.GHL_CLIENT_SECRET, config.CRM_TOKEN_ENCRYPTION_KEY, config.GHL_LOCATION_ID, config.GHL_PIPELINE_ID];
      if (required.some((value) => !value?.trim())) throw new Error("GHL delivery configuration is incomplete (BLOCKED_EXTERNAL)");
      const tokens = createGhlAccessTokenProvider({
        clientId: config.GHL_CLIENT_ID!,
        clientSecret: config.GHL_CLIENT_SECRET!,
        expectedLocationId: config.GHL_LOCATION_ID!,
        store: new PrismaGhlTokenStore(config.GHL_LOCATION_ID!, config.CRM_TOKEN_ENCRYPTION_KEY!),
      });
      return new GhlCrmAdapter(new GhlHttpClient(tokens), {
        locationId: config.GHL_LOCATION_ID!,
        pipelineId: config.GHL_PIPELINE_ID!,
        pipelineStageId: config.GHL_PIPELINE_STAGE_ID,
        resolveAgentUserId: async (agentId) => {
          const mappings = await db.externalIdentity.findMany({
            where: { provider: GHL_AGENT_MAPPING_PROVIDER, entityKind: GHL_AGENT_MAPPING_KIND, canonicalEntityId: agentId },
            take: 2,
          });
          if (mappings.length !== 1) return null;
          return verifiedGhlAgentId(mappings[0].metadataJson, mappings[0].externalId, config.GHL_LOCATION_ID!);
        },
      });
    }
    case "custom":
      throw new Error(`CRM provider '${provider}' requires credentials — see docs/BLOCKERS.md`);
    default:
      return new LocalDevCrmAdapter();
  }
}

/* Delivery orchestration: idempotency, retries handled by job runner, DLQ on max attempts */

export async function deliverLeadToCrm(leadId: string, options: { forceAssignmentReconcile?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  options.signal?.throwIfAborted();
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      contact: true,
      context: true,
      ownerAgent: true,
      consents: true,
      assignments: true,
    },
  });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const idempotencyKey = `lead:${lead.id}:v1`;
  const existing = await db.crmSyncRecord.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "DELIVERED" && !options.forceAssignmentReconcile) {
    if (existing.organizationId !== lead.organizationId) {
      await db.crmSyncRecord.update({ where: { id: existing.id }, data: { organizationId: lead.organizationId } });
    }
    return; // exactly-once effect
  }

  const payload: CrmLeadPayload = {
    leadId: lead.id,
    reference: lead.id.slice(-8).toUpperCase(),
    intent: lead.intent,
    status: lead.status,
    sourceChannel: lead.sourceChannel,
    contact: {
      name: lead.contact.name,
      email: lead.contact.email,
      phoneE164: lead.contact.phoneE164,
      dedupeKey: lead.contact.dedupeKey,
    },
    message: lead.message,
    entity: {
      type: lead.primaryEntityType,
      id: lead.primaryEntityId,
      slug: lead.primaryEntitySlug,
      title: null,
    },
    attribution: {
      landingUrl: lead.context?.landingUrl ?? null,
      referrer: lead.context?.referrer ?? null,
      utmSource: lead.context?.utmSource ?? null,
      utmMedium: lead.context?.utmMedium ?? null,
      utmCampaign: lead.context?.utmCampaign ?? null,
      utmContent: lead.context?.utmContent ?? null,
      utmTerm: lead.context?.utmTerm ?? null,
      pagePath: lead.context?.pagePath ?? null,
      aiConversationId: lead.context?.aiConversationId ?? null,
      locale: lead.context?.locale ?? "en",
      deviceClass: lead.context?.deviceClass ?? null,
    },
    assignment: {
      ownerAgentId: lead.ownerAgentId,
      ownerAgentName: lead.ownerAgent?.name ?? null,
      reason: lead.assignments[0]?.reason ?? null,
    },
    consent: {
      contact: lead.consents.some((c) => c.purpose === "LEAD_CONTACT" && c.status === "GRANTED"),
      marketing: lead.consents.some((c) => c.purpose === "MARKETING" && c.status === "GRANTED"),
      policyVersion: lead.consents[0]?.policyVersion ?? "2026-09-v1",
    },
    submittedAt: lead.createdAt.toISOString(),
  };

  // entity title resolution
  if (lead.primaryEntityType === "PROPERTY" && lead.primaryEntityId) {
    const p = await db.property.findUnique({ where: { id: lead.primaryEntityId }, select: { title: true } });
    payload.entity.title = p?.title ?? null;
  } else if (lead.primaryEntityType === "PROJECT" && lead.primaryEntityId) {
    const pr = await db.project.findUnique({ where: { id: lead.primaryEntityId }, select: { name: true } });
    payload.entity.title = pr?.name ?? null;
  }

  const record = existing
    ? await db.crmSyncRecord.update({
        where: { id: existing.id },
        data: { organizationId: lead.organizationId, payloadJson: toJsonValue(payload) },
      })
    : await db.crmSyncRecord.create({
        data: {
          organizationId: lead.organizationId,
          leadId: lead.id,
          provider: getConfig().CRM_PROVIDER,
          idempotencyKey,
          payloadJson: toJsonValue(payload),
          status: "PENDING",
        },
      });

  const adapter = getAdapter();
  try {
    options.signal?.throwIfAborted();
    const { externalId, response } = await adapter.deliver(payload, idempotencyKey, options.signal);
    await db.crmSyncRecord.update({
      where: { id: record.id },
      data: {
        status: "DELIVERED",
        responseJson: JSON.stringify(response),
        deliveredAt: new Date(),
        externalId,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
      },
    });
    await db.leadEvent.create({
      data: { leadId: lead.id, eventType: "CRM_DELIVERED", payloadJson: JSON.stringify({ externalId, provider: adapter.provider }), actorType: "SYSTEM" },
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    const attempts = record.attempts + 1;
    const dead = attempts >= 5;
    await db.crmSyncRecord.update({
      where: { id: record.id },
      data: {
        status: dead ? "DEAD" : "RETRYING",
        attempts,
        lastAttemptAt: new Date(),
        lastError: String(err).slice(0, 500),
        nextRetryAt: dead ? null : new Date(Date.now() + Math.min(15_000 * 2 ** attempts, 15 * 60_000)),
      },
    });
    await db.leadEvent.create({
      data: { leadId: lead.id, eventType: dead ? "CRM_DEAD" : "CRM_RETRY", payloadJson: JSON.stringify({ error: String(err).slice(0, 300), attempts }), actorType: "SYSTEM" },
    });
    if (dead) {
      await db.deadLetterEvent.create({
        data: {
          jobKey: "crm.lead.deliver",
          sourceId: record.id,
          payloadJson: toJsonValue({ leadId: lead.id }),
          error: String(err).slice(0, 500),
          attempts,
        },
      });
    }
    throw err; // job runner schedules retry
  }
}

export function shouldSkipLeadAssignmentSync(previousOwnerAgentId: string | null, currentOwnerAgentId: string | null, syncStatus: string): boolean {
  return previousOwnerAgentId === currentOwnerAgentId && syncStatus === "DELIVERED";
}

/** Reconcile an explicit Admin owner change for an already delivered GHL lead. */
export async function syncLeadAssignmentToCrm(leadId: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const config = getConfig();
  if (config.CRM_PROVIDER !== "ghl") return;
  const [lead, existing] = await Promise.all([
    db.lead.findUnique({ where: { id: leadId }, select: { ownerAgentId: true } }),
    db.crmSyncRecord.findUnique({ where: { idempotencyKey: `lead:${leadId}:v1` } }),
  ]);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!existing || existing.provider !== "ghl" || !existing.externalId) return;
  if (!["DELIVERED", "FAILED", "RETRYING", "DEAD"].includes(existing.status)) return;

  const lastPayload = parseJson<CrmLeadPayload | null>(existing.payloadJson, null);
  const previousOwnerAgentId = lastPayload?.assignment?.ownerAgentId ?? null;
  if (shouldSkipLeadAssignmentSync(previousOwnerAgentId, lead.ownerAgentId, existing.status)) return;

  const reconciliationRequired = async (reason: string) => {
    const at = new Date();
    await db.$transaction(async (tx) => {
      await tx.crmSyncRecord.update({
        where: { id: existing.id },
        data: { status: "FAILED", lastError: reason, lastAttemptAt: at, nextRetryAt: null },
      });
      await tx.leadEvent.create({
        data: {
          leadId,
          eventType: "CRM_ASSIGNMENT_RECONCILIATION_REQUIRED",
          payloadJson: JSON.stringify({ reason: "GHL_OWNER_UPDATE_NOT_SENT" }),
          actorType: "SYSTEM",
        },
      });
    });
  };

  if (!lead.ownerAgentId) {
    await reconciliationRequired("GHL owner removal was not sent; provider unassignment semantics require verification.");
    return;
  }
  if (!config.CRM_LIVE_ENABLED) {
    await reconciliationRequired("IERE owner changed, but GHL assignment sync is disabled by server configuration.");
    return;
  }

  await deliverLeadToCrm(leadId, { forceAssignmentReconcile: true, signal });
}

export function shouldSkipLeadStatusSync(previousStatus: string | null, currentStatus: string, syncStatus: string): boolean {
  return previousStatus === currentStatus && syncStatus === "DELIVERED";
}

/** Reconcile an explicit Admin lead-status change for an existing GHL opportunity. */
export async function syncLeadStatusToCrm(leadId: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const config = getConfig();
  if (config.CRM_PROVIDER !== "ghl") return;
  const [lead, existing] = await Promise.all([
    db.lead.findUnique({ where: { id: leadId }, select: { status: true, organizationId: true } }),
    db.crmSyncRecord.findUnique({ where: { idempotencyKey: `lead:${leadId}:v1` } }),
  ]);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  // A pending initial delivery will create the opportunity using the current status.
  if (!existing || existing.provider !== "ghl" || !existing.externalId) return;
  if (!["DELIVERED", "FAILED", "RETRYING", "DEAD"].includes(existing.status)) return;

  const previousResponse = parseJson<Record<string, unknown>>(existing.responseJson, {});
  const previousStatus = typeof previousResponse.opportunityStatus === "string" ? previousResponse.opportunityStatus : null;
  const mappedStatus: GhlOpportunityStatus | null = mapIereLeadStatusToGhl(lead.status);
  if (mappedStatus && shouldSkipLeadStatusSync(previousStatus, mappedStatus, existing.status)) return;

  const reconciliationRequired = async (reason: string) => {
    const at = new Date();
    await db.$transaction(async (tx) => {
      await tx.crmSyncRecord.update({
        where: { id: existing.id },
        data: { organizationId: lead.organizationId, status: "FAILED", lastError: reason, lastAttemptAt: at, nextRetryAt: null },
      });
      await tx.leadEvent.create({
        data: {
          leadId,
          eventType: "CRM_STATUS_RECONCILIATION_REQUIRED",
          payloadJson: JSON.stringify({ reason: "GHL_STATUS_UPDATE_NOT_SENT" }),
          actorType: "SYSTEM",
        },
      });
    });
  };

  if (!mappedStatus) {
    await reconciliationRequired("IERE lead status has no approved GHL opportunity-status mapping; manual reconciliation is required.");
    return;
  }
  if (!config.CRM_LIVE_ENABLED) {
    await reconciliationRequired("IERE lead status changed, but GHL status sync is disabled by server configuration.");
    return;
  }

  try {
    const adapter = getAdapter();
    if (!(adapter instanceof GhlCrmAdapter)) throw new Error("Configured GHL adapter is unavailable for status synchronization");
    await adapter.updateOpportunityStatus(existing.externalId, mappedStatus, signal);
    const at = new Date();
    await db.$transaction(async (tx) => {
      await tx.crmSyncRecord.update({
        where: { id: existing.id },
        data: {
          organizationId: lead.organizationId,
          status: "DELIVERED",
          responseJson: JSON.stringify({ ...previousResponse, opportunityStatus: mappedStatus }),
          deliveredAt: at,
          attempts: { increment: 1 },
          lastAttemptAt: at,
          lastError: null,
          nextRetryAt: null,
        },
      });
      await tx.leadEvent.create({
        data: { leadId, eventType: "CRM_STATUS_SYNCED", payloadJson: JSON.stringify({ opportunityStatus: mappedStatus }), actorType: "SYSTEM" },
      });
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const attempts = existing.attempts + 1;
    const dead = attempts >= 5;
    const message = String(err).slice(0, 500);
    await db.$transaction(async (tx) => {
      await tx.crmSyncRecord.update({
        where: { id: existing.id },
        data: {
          organizationId: lead.organizationId,
          status: dead ? "DEAD" : "RETRYING",
          attempts,
          lastAttemptAt: new Date(),
          lastError: message,
          nextRetryAt: dead ? null : new Date(Date.now() + Math.min(15_000 * 2 ** attempts, 15 * 60_000)),
        },
      });
      await tx.leadEvent.create({
        data: {
          leadId,
          eventType: dead ? "CRM_STATUS_DEAD" : "CRM_STATUS_RETRY",
          payloadJson: JSON.stringify({ error: message.slice(0, 300), attempts }),
          actorType: "SYSTEM",
        },
      });
    });
    if (dead) {
      await db.deadLetterEvent.create({
        data: { jobKey: "crm.lead.status.sync", sourceId: existing.id, payloadJson: toJsonValue({ leadId }), error: message, attempts },
      });
    }
    throw err;
  }
}

/** Reconciliation report (admin) */
export async function crmReconciliation(organizationId?: string | null) {
  const where = organizationId === undefined ? {} : { organizationId: organizationId ?? "__no_organization__" };
  const records = await db.crmSyncRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
  const leads = await db.lead.count({ where });
  const delivered = records.filter((r) => r.status === "DELIVERED").length;
  const pending = records.filter((r) => r.status === "PENDING" || r.status === "RETRYING").length;
  const dead = records.filter((r) => r.status === "DEAD" || r.status === "FAILED").length;
  return {
    provider: getConfig().CRM_PROVIDER,
    totalLeads: leads,
    syncRecords: records.length,
    delivered,
    pending,
    dead,
    unreconciled: Math.max(0, leads - delivered - pending - dead),
  };
}

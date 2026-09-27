import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit } from "@/server/auth";
import { requireGhlAdmin } from "@/server/crm/ghl-oauth-admin";
import { createGhlAccessTokenProvider, GhlApiError, GhlHttpClient } from "@/server/crm/ghl-client";
import { PrismaGhlTokenStore } from "@/server/crm/ghl-token-store";
import { ghlOAuthSettings } from "@/server/crm/ghl-oauth-config";
import { GHL_AGENT_MAPPING_KIND, GHL_AGENT_MAPPING_PROVIDER, verifiedGhlAgent, verifiedGhlAgentId } from "@/server/crm/ghl-agent-mapping";
import { HttpError } from "@/server/auth";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const actor = await requireGhlAdmin();
  const config = getConfig();
  const locationId = config.GHL_LOCATION_ID?.trim() ?? "";
  const agents = await db.agent.findMany({
    where: {
      active: true,
      ...(!actor.roles.includes("OWNER") ? { user: { is: { organizationId: actor.organizationId ?? "__no_organization__" } } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  const ids = agents.map((agent) => agent.id);
  const mappings = ids.length ? await db.externalIdentity.findMany({
    where: {
      provider: GHL_AGENT_MAPPING_PROVIDER,
      entityKind: GHL_AGENT_MAPPING_KIND,
      canonicalEntityId: { in: ids },
    },
    orderBy: { retrievedAt: "desc" },
  }) : [];
  const byAgent = new Map<string, typeof mappings>();
  for (const mapping of mappings) byAgent.set(mapping.canonicalEntityId, [...(byAgent.get(mapping.canonicalEntityId) ?? []), mapping]);
  return NextResponse.json({
    locationConfigured: Boolean(locationId),
    agents: agents.map((agent) => {
      const rows = byAgent.get(agent.id) ?? [];
      const mapping = rows.length === 1 && locationId && verifiedGhlAgentId(rows[0].metadataJson, rows[0].externalId, locationId) ? rows[0] : null;
      let providerName: string | null = null;
      if (mapping?.metadataJson) {
        try {
          const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
          providerName = typeof metadata.providerName === "string" ? metadata.providerName : null;
        } catch { /* malformed legacy evidence remains unmapped */ }
      }
      return {
        id: agent.id,
        name: agent.name,
        mapping: mapping ? { ghlUserId: mapping.externalId, providerName, verifiedAt: mapping.retrievedAt.toISOString() } : null,
        mappingConflict: rows.length > 1,
      };
    }),
  });
});

const verifySchema = z.object({
  agentId: z.string().trim().min(1).max(100),
  ghlUserId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/, "Enter a valid GHL user ID."),
}).strict();

export const POST = apiHandler(async (request) => {
  const actor = await requireGhlAdmin();
  const input = verifySchema.parse(await jsonBody<z.infer<typeof verifySchema>>(request));
  const config = getConfig();
  const settings = ghlOAuthSettings(config);
  const agent = await db.agent.findFirst({
    where: {
      id: input.agentId,
      active: true,
      ...(!actor.roles.includes("OWNER") ? { user: { is: { organizationId: actor.organizationId ?? "__no_organization__" } } } : {}),
    },
    select: { id: true, name: true },
  });
  if (!agent) throw new HttpError(404, "Active IERE agent not found in your organization.", "GHL_AGENT_NOT_FOUND");

  const tokens = createGhlAccessTokenProvider({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    expectedLocationId: settings.locationId,
    store: new PrismaGhlTokenStore(settings.locationId, settings.tokenEncryptionKey),
  });
  let verified: ReturnType<typeof verifiedGhlAgent>;
  try {
    const response = await new GhlHttpClient(tokens).request<unknown>(`/users/${encodeURIComponent(input.ghlUserId)}`);
    verified = verifiedGhlAgent(response, input.ghlUserId, settings.locationId);
  } catch (error) {
    if (error instanceof GhlApiError && error.status === 403) {
      throw new HttpError(409, "GHL denied user verification (HTTP 403). Confirm the connected app has users.readonly access and the user is visible to this location.", "GHL_USER_SCOPE_REQUIRED");
    }
    throw error;
  }

  const conflictingMapping = await db.externalIdentity.findUnique({
    where: { provider_entityKind_externalId: { provider: GHL_AGENT_MAPPING_PROVIDER, entityKind: GHL_AGENT_MAPPING_KIND, externalId: verified.id } },
    select: { canonicalEntityId: true },
  });
  if (conflictingMapping && conflictingMapping.canonicalEntityId !== agent.id) {
    throw new HttpError(409, "That GHL user is already mapped to a different IERE agent.", "GHL_USER_ALREADY_MAPPED");
  }

  const retrievedAt = new Date();
  await db.$transaction(async (tx) => {
    const previous = await tx.externalIdentity.findMany({
      where: { provider: GHL_AGENT_MAPPING_PROVIDER, entityKind: GHL_AGENT_MAPPING_KIND, canonicalEntityId: agent.id },
      select: { externalId: true },
    });
    await tx.externalIdentity.deleteMany({
      where: { provider: GHL_AGENT_MAPPING_PROVIDER, entityKind: GHL_AGENT_MAPPING_KIND, canonicalEntityId: agent.id },
    });
    await tx.externalIdentity.create({
      data: {
        provider: GHL_AGENT_MAPPING_PROVIDER,
        entityKind: GHL_AGENT_MAPPING_KIND,
        externalId: verified.id,
        canonicalEntityId: agent.id,
        retrievedAt,
        metadataJson: JSON.stringify({
          verified: true,
          locationId: settings.locationId,
          providerName: verified.name,
          verifiedBy: actor.id,
          source: "GET /users/:userId",
        }),
      },
    });
    await audit({
      actorId: actor.id,
      organizationId: actor.organizationId,
      action: "ghl.agent_mapping.verified",
      resourceType: "agent",
      resourceId: agent.id,
      before: { ghlUserIds: previous.map((row) => row.externalId) },
      after: { ghlUserId: verified.id, providerName: verified.name, locationId: settings.locationId },
    }, tx);
  });

  return NextResponse.json({ agentId: agent.id, agentName: agent.name, mapping: { ghlUserId: verified.id, providerName: verified.name, verifiedAt: retrievedAt.toISOString() } });
}, { rateLimit: { limit: 10, windowMs: 60_000, key: "ghl-agent-verify" } });

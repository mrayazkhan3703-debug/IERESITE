import { createHash } from "node:crypto";
import type { CrmAdapter, CrmLeadPayload } from "@/server/crm/adapter";
import type { GhlApi } from "@/server/crm/ghl-client";

export interface GhlCrmConfig {
  locationId: string;
  pipelineId: string;
  pipelineStageId?: string;
  resolveAgentUserId?: (agentId: string) => Promise<string | null>;
}

export type GhlOpportunityStatus = "open" | "won" | "lost" | "abandoned";

/** Conservative local pipeline mapping; SPAM is intentionally not inferred as abandoned. */
export function mapIereLeadStatusToGhl(status: string): GhlOpportunityStatus | null {
  if (status === "WON") return "won";
  if (status === "LOST") return "lost";
  if (["NEW", "ATTEMPTED", "CONTACTED", "QUALIFIED", "NURTURE"].includes(status)) return "open";
  return null;
}

interface ContactMatch {
  id: string;
  locationId?: string;
}

interface OpportunityMatch {
  id: string;
  name: string;
  locationId: string;
  pipelineId: string;
  contactId: string;
}

export class GhlIdentityConflictError extends Error {
  constructor(message = "GHL contact identity is ambiguous; manual resolution is required") {
    super(message);
    this.name = "GhlIdentityConflictError";
  }
}

function required(value: string, name: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`GHL ${name} is required; live delivery is blocked until verified configuration exists`);
  return clean;
}

function contactMatches(value: unknown): { contacts: ContactMatch[]; hasNextPage: boolean } {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).contacts)) {
    throw new Error("GHL contact lookup response did not match the expected contract");
  }
  const response = value as { contacts: unknown[]; nextCursor?: unknown };
  const contacts: ContactMatch[] = response.contacts.map((contact) => {
    if (!contact || typeof contact !== "object") throw new Error("GHL contact lookup returned an invalid contact");
    const row = contact as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) throw new Error("GHL contact lookup returned a contact without an ID");
    return { id: row.id, locationId: typeof row.locationId === "string" ? row.locationId : undefined };
  });
  return { contacts, hasNextPage: typeof response.nextCursor === "string" && response.nextCursor.length > 0 };
}

function opportunityMatches(value: unknown): OpportunityMatch[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).opportunities)) {
    throw new Error("GHL opportunity search response did not match the expected contract");
  }
  return ((value as { opportunities: unknown[] }).opportunities).map((opportunity) => {
    if (!opportunity || typeof opportunity !== "object") throw new Error("GHL opportunity search returned an invalid opportunity");
    const row = opportunity as Record<string, unknown>;
    if ([row.id, row.name, row.locationId, row.pipelineId, row.contactId].some((field) => typeof field !== "string" || !field)) {
      throw new Error("GHL opportunity search returned incomplete identity fields");
    }
    return {
      id: row.id as string,
      name: row.name as string,
      locationId: row.locationId as string,
      pipelineId: row.pipelineId as string,
      contactId: row.contactId as string,
    };
  });
}

/** CRM mapping uses only verified IDs and minimal contact/opportunity data. */
export class GhlCrmAdapter implements CrmAdapter {
  readonly provider = "ghl";
  private readonly locationId: string;
  private readonly pipelineId: string;
  private readonly pipelineStageId?: string;
  private readonly resolveAgentUserId?: (agentId: string) => Promise<string | null>;

  constructor(private readonly api: GhlApi, config: GhlCrmConfig) {
    this.locationId = required(config.locationId, "location ID");
    this.pipelineId = required(config.pipelineId, "pipeline ID");
    this.pipelineStageId = config.pipelineStageId?.trim() || undefined;
    this.resolveAgentUserId = config.resolveAgentUserId;
  }

  async deliver(payload: CrmLeadPayload, idempotencyKey: string, signal?: AbortSignal): Promise<{ externalId: string | null; response: unknown }> {
    signal?.throwIfAborted();
    if (!payload.consent.contact) throw new Error("GHL delivery requires recorded contact consent");
    const opportunityStatus = mapIereLeadStatusToGhl(payload.status);
    if (!opportunityStatus) throw new Error("GHL delivery is blocked: IERE SPAM status has no approved opportunity-status mapping");
    const email = payload.contact.email?.trim().toLowerCase() || undefined;
    const phone = payload.contact.phoneE164?.trim() || undefined;
    if (!email && !phone) throw new Error("GHL contact delivery requires an email or E.164 phone number");
    const ownerAgentId = payload.assignment.ownerAgentId?.trim();
    const assignedTo = ownerAgentId
      ? await this.resolveAssignedUserId(ownerAgentId)
      : undefined;

    const candidates: ContactMatch[] = [];
    if (email) candidates.push(...await this.lookup("email", email, signal));
    if (phone) candidates.push(...await this.lookup("phone", phone, signal));
    const uniqueCandidates = new Map(candidates.map((contact) => [contact.id, contact]));
    if (uniqueCandidates.size > 1) throw new GhlIdentityConflictError();
    const existingContact = uniqueCandidates.values().next().value as ContactMatch | undefined;

    const upsert = await this.api.request<unknown>("/contacts/upsert", {
      method: "POST",
      signal,
      body: {
        locationId: this.locationId,
        name: payload.contact.name,
        email: email ?? null,
        phone: phone ?? null,
        source: `IERE ${payload.sourceChannel}`,
        createNewIfDuplicateAllowed: false,
      },
    });
    if (!upsert || typeof upsert !== "object" || !("contact" in upsert)) {
      throw new Error("GHL contact upsert response did not match the expected contract");
    }
    const contactRow = (upsert as { contact?: unknown }).contact;
    if (!contactRow || typeof contactRow !== "object" || typeof (contactRow as Record<string, unknown>).id !== "string") {
      throw new Error("GHL contact upsert returned no contact ID");
    }
    const contact = contactRow as { id: string; locationId?: string };
    if (contact.locationId && contact.locationId !== this.locationId) throw new GhlIdentityConflictError("GHL returned a contact outside the configured location");
    if (existingContact && contact.id !== existingContact.id) throw new GhlIdentityConflictError("GHL upsert selected a different contact than the identity preflight");

    const marker = `IERE-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
    const name = `${marker} ${payload.intent}`;
    const search = await this.api.request<unknown>("/opportunities/search", {
      signal,
      query: {
        locationId: this.locationId,
        pipelineId: this.pipelineId,
        contactId: contact.id,
        q: marker,
        status: "all",
        limit: "20",
      },
    });
    const matches = opportunityMatches(search).filter((opportunity) => opportunity.name === name);
    if (matches.length > 1) throw new GhlIdentityConflictError("Multiple GHL opportunities match this IERE delivery key");
    let opportunityId: string;
    let reusedOpportunity = false;
    const existingOpportunity = matches[0];
    if (existingOpportunity) {
      if (existingOpportunity.locationId !== this.locationId || existingOpportunity.pipelineId !== this.pipelineId || existingOpportunity.contactId !== contact.id) {
        throw new GhlIdentityConflictError("GHL opportunity marker matched a different location, pipeline, or contact");
      }
      opportunityId = existingOpportunity.id;
      reusedOpportunity = true;
      if (assignedTo) {
        await this.api.request<unknown>(`/opportunities/${encodeURIComponent(opportunityId)}`, {
          method: "PUT",
          signal,
          body: { assignedTo },
        });
      }
      await this.updateOpportunityStatus(opportunityId, opportunityStatus, signal);
    } else {
      const body: Record<string, unknown> = {
        locationId: this.locationId,
        pipelineId: this.pipelineId,
        name,
        status: opportunityStatus,
        contactId: contact.id,
      };
      if (this.pipelineStageId) body.pipelineStageId = this.pipelineStageId;
      if (assignedTo) body.assignedTo = assignedTo;
      const created = await this.api.request<unknown>("/opportunities/", { method: "POST", body, signal });
      if (!created || typeof created !== "object" || !("opportunity" in created)) {
        throw new Error("GHL opportunity create response did not match the expected contract");
      }
      const opportunity = (created as { opportunity?: unknown }).opportunity;
      if (!opportunity || typeof opportunity !== "object" || typeof (opportunity as Record<string, unknown>).id !== "string") {
        throw new Error("GHL opportunity create returned no opportunity ID");
      }
      opportunityId = (opportunity as { id: string }).id;
    }

    return {
      externalId: opportunityId,
      response: {
        contactId: contact.id,
        opportunityId,
        opportunityStatus,
        contactCreated: (upsert as { new?: unknown }).new === true,
        opportunityReused: reusedOpportunity,
      },
    };
  }

  async updateOpportunityStatus(opportunityId: string, status: GhlOpportunityStatus, signal?: AbortSignal): Promise<void> {
    const id = required(opportunityId, "opportunity ID");
    const response = await this.api.request<unknown>(`/opportunities/${encodeURIComponent(id)}/status`, {
      method: "PUT",
      body: { status },
      signal,
    });
    if (!response || typeof response !== "object" || (response as Record<string, unknown>).success !== true) {
      throw new Error("GHL opportunity status update response did not confirm success");
    }
  }

  private async resolveAssignedUserId(agentId: string): Promise<string> {
    if (!this.resolveAgentUserId) throw new Error("GHL delivery is blocked: this assigned IERE agent has no verified GHL user mapping");
    const externalId = await this.resolveAgentUserId(agentId);
    if (!externalId) throw new Error("GHL delivery is blocked: this assigned IERE agent has no verified GHL user mapping for the configured location");
    return externalId;
  }

  private async lookup(field: "email" | "phone", value: string, signal?: AbortSignal): Promise<ContactMatch[]> {
    const query: Record<string, string> = { locationId: this.locationId, [field]: value, limit: "20" };
    const result = contactMatches(await this.api.request<unknown>("/contacts/lookup", { query, signal }));
    if (result.hasNextPage) throw new GhlIdentityConflictError("GHL identity lookup exceeded the safe duplicate-check limit");
    const unique = new Map(result.contacts.map((contact) => [contact.id, contact]));
    if (unique.size > 1) throw new GhlIdentityConflictError();
    for (const contact of unique.values()) {
      if (contact.locationId && contact.locationId !== this.locationId) throw new GhlIdentityConflictError("GHL identity lookup returned a contact outside the configured location");
    }
    return [...unique.values()];
  }
}

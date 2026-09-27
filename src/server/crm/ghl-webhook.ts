import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { db, toJsonValue } from "@/lib/db";

/** Public verification key published in HighLevel's Marketplace webhook guide. */
export const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export const GHL_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export interface GhlWebhookReceipt {
  providerEventId: string;
  eventType: string;
  locationId: string;
  entityId: string | null;
  payloadJson: Record<string, unknown>;
  loopSuppressed: boolean;
}

export interface GhlWebhookStore {
  accept(receipt: GhlWebhookReceipt): Promise<{ duplicate: boolean }>;
}

export class GhlWebhookEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhlWebhookEnvelopeError";
  }
}

export class GhlWebhookConflictError extends Error {
  constructor() {
    super("GHL webhook event ID was reused with different event identity");
    this.name = "GhlWebhookConflictError";
  }
}

/** Verifies the exact body bytes. Invalid modern signatures never fall back to a legacy header. */
export function verifyGhlWebhookSignature(
  rawBody: Uint8Array,
  signature: string | null,
  publicKeyPem = GHL_WEBHOOK_PUBLIC_KEY,
): boolean {
  if (!signature || signature === "N/A" || signature.length > 128) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;

  try {
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== signature) return false;
    return verifySignature(null, Buffer.from(rawBody), createPublicKey(publicKeyPem), decoded);
  } catch {
    return false;
  }
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses only after signature verification and returns a PII-minimal receipt projection. */
export function parseGhlWebhookReceipt(rawBody: Uint8Array): GhlWebhookReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    throw new GhlWebhookEnvelopeError("GHL webhook body is not valid UTF-8 JSON");
  }
  if (!isRecord(parsed)) throw new GhlWebhookEnvelopeError("GHL webhook envelope must be a JSON object");

  const eventType = parsed.type;
  if (typeof eventType !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,119}$/.test(eventType)) {
    throw new GhlWebhookEnvelopeError("GHL webhook event type is invalid");
  }

  const data = isRecord(parsed.data) ? parsed.data : parsed;
  const rootLocationId = safeId(parsed.locationId);
  const dataLocationId = safeId(data.locationId);
  if (rootLocationId && dataLocationId && rootLocationId !== dataLocationId) {
    throw new GhlWebhookEnvelopeError("GHL webhook location fields do not agree");
  }
  const locationId = rootLocationId ?? dataLocationId;
  if (!locationId) throw new GhlWebhookEnvelopeError("GHL webhook location ID is required");

  const webhookId = safeId(parsed.webhookId);
  if (!webhookId) throw new GhlWebhookEnvelopeError("GHL webhook delivery ID is required for safe deduplication");
  const providerEventId = webhookId;
  const entityId = safeId(data.id);
  const payloadKeys = Object.keys(data).filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)).slice(0, 64).sort();

  // Current outbound adapter uses this stable marker for opportunities. Such echoes
  // are recorded but never fanned back into local domain writes or the CRM outbox.
  const name = typeof data.name === "string" ? data.name : "";
  const loopSuppressed = /^IERE-[a-f0-9]{24}\s/.test(name);

  return {
    providerEventId,
    eventType,
    locationId,
    entityId,
    payloadJson: { webhookId, locationId, entityId, payloadKeys },
    loopSuppressed,
  };
}

export class PrismaGhlWebhookStore implements GhlWebhookStore {
  constructor(private readonly client: PrismaClient = db) {}

  async accept(receipt: GhlWebhookReceipt): Promise<{ duplicate: boolean }> {
    const inserted = await this.client.webhookEvent.createMany({
      data: [{
        provider: "ghl",
        providerEventId: receipt.providerEventId,
        eventType: receipt.eventType,
        locationId: receipt.locationId,
        entityId: receipt.entityId,
        signatureOk: true,
        processingStatus: receipt.loopSuppressed ? "IGNORED" : "RECEIVED",
        loopSuppressed: receipt.loopSuppressed,
        payloadJson: toJsonValue(receipt.payloadJson),
        processedAt: receipt.loopSuppressed ? new Date() : null,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { duplicate: false };

    const existing = await this.client.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider: "ghl", providerEventId: receipt.providerEventId } },
      select: { eventType: true, locationId: true, entityId: true, loopSuppressed: true },
    });
    if (!existing) throw new Error("GHL webhook duplicate receipt could not be read");
    if (existing.eventType !== receipt.eventType || existing.locationId !== receipt.locationId
      || existing.entityId !== receipt.entityId || existing.loopSuppressed !== receipt.loopSuppressed) {
      throw new GhlWebhookConflictError();
    }
    return { duplicate: true };
  }
}

/** Receipt only. There is deliberately no event/outbox dispatch until inbound mappings are approved. */
export async function receiveGhlWebhook(
  store: GhlWebhookStore,
  receipt: GhlWebhookReceipt,
  expectedLocationId: string,
): Promise<{ duplicate: boolean }> {
  if (!expectedLocationId || receipt.locationId !== expectedLocationId) {
    throw new GhlWebhookEnvelopeError("GHL webhook location is not configured for this integration");
  }
  return store.accept(receipt);
}

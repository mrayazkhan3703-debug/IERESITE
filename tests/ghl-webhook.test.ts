import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  GhlWebhookEnvelopeError,
  parseGhlWebhookReceipt,
  receiveGhlWebhook,
  verifyGhlWebhookSignature,
  type GhlWebhookReceipt,
  type GhlWebhookStore,
} from "@/server/crm/ghl-webhook";

describe("GHL signed webhook receipt contract", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const raw = Buffer.from('{"type":"ContactCreate","webhookId":"synthetic-delivery-1","locationId":"location-test","id":"contact-test","name":"Synthetic Person","email":"synthetic@example.invalid"}');
  const signature = sign(null, raw, keys.privateKey).toString("base64");

  it("verifies Ed25519 over exact raw bytes and rejects missing, malformed, or altered signatures", () => {
    expect(verifyGhlWebhookSignature(raw, signature, publicKey)).toBe(true);
    expect(verifyGhlWebhookSignature(Buffer.from(`${raw.toString()} `), signature, publicKey)).toBe(false);
    expect(verifyGhlWebhookSignature(raw, null, publicKey)).toBe(false);
    expect(verifyGhlWebhookSignature(raw, "N/A", publicKey)).toBe(false);
    expect(verifyGhlWebhookSignature(raw, "not-base64!", publicKey)).toBe(false);
  });

  it("requires a delivery ID and keeps only a PII-minimal receipt projection", () => {
    const receipt = parseGhlWebhookReceipt(raw);
    expect(receipt).toMatchObject({
      providerEventId: "synthetic-delivery-1",
      eventType: "ContactCreate",
      locationId: "location-test",
      entityId: "contact-test",
    });
    const stored = JSON.stringify(receipt.payloadJson).toLowerCase();
    expect(stored).not.toContain("synthetic person");
    expect(stored).not.toContain("synthetic@example.invalid");
    expect(receipt.payloadJson).toHaveProperty("payloadKeys");

    const bodyWithoutDeliveryId = Buffer.from('{"type":"ContactUpdate","locationId":"location-test","id":"contact-test","phone":"+971500000000"}');
    expect(() => parseGhlWebhookReceipt(bodyWithoutDeliveryId)).toThrow(GhlWebhookEnvelopeError);
  });

  it("rejects malformed or cross-location envelopes and identifies outbound opportunity echoes", () => {
    expect(() => parseGhlWebhookReceipt(Buffer.from("[]"))).toThrow(GhlWebhookEnvelopeError);
    expect(() => parseGhlWebhookReceipt(Buffer.from('{"type":"ContactCreate"}'))).toThrow(GhlWebhookEnvelopeError);

    const echo = parseGhlWebhookReceipt(Buffer.from(JSON.stringify({
      type: "OpportunityCreate",
      webhookId: "synthetic-echo",
      locationId: "location-test",
      id: "opportunity-test",
      name: "IERE-0123456789abcdef01234567 PROPERTY_INQUIRY",
    })));
    expect(echo.loopSuppressed).toBe(true);

    const store: GhlWebhookStore = { accept: async (_receipt: GhlWebhookReceipt) => ({ duplicate: false }) };
    return expect(receiveGhlWebhook(store, parseGhlWebhookReceipt(raw), "another-location")).rejects.toThrow(GhlWebhookEnvelopeError);
  });

  it("acknowledges duplicates through the storage contract without dispatching domain work", async () => {
    let received: GhlWebhookReceipt | undefined;
    const store: GhlWebhookStore = {
      accept: async (receipt) => {
        received = receipt;
        return { duplicate: true };
      },
    };
    const result = await receiveGhlWebhook(store, parseGhlWebhookReceipt(raw), "location-test");
    expect(result).toEqual({ duplicate: true });
    expect(received?.payloadJson).not.toHaveProperty("email");
  });
});

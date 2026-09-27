import { afterAll, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { GhlWebhookConflictError, parseGhlWebhookReceipt, PrismaGhlWebhookStore, receiveGhlWebhook } from "@/server/crm/ghl-webhook";

const store = new PrismaGhlWebhookStore(db);
const eventId = `test-${randomBytes(10).toString("hex")}`;
const raw = Buffer.from(JSON.stringify({
  type: "ContactCreate",
  webhookId: eventId,
  locationId: "synthetic-location",
  id: "synthetic-contact",
  name: "Synthetic Privacy Fixture",
  email: "synthetic-webhook@example.invalid",
}));
const receipt = parseGhlWebhookReceipt(raw);

afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { provider: "ghl", providerEventId: receipt.providerEventId } });
  await db.$disconnect();
});

it("persists a privacy-minimal receipt and atomically deduplicates concurrent deliveries", async () => {
  const results = await Promise.all([
    receiveGhlWebhook(store, receipt, "synthetic-location"),
    receiveGhlWebhook(store, receipt, "synthetic-location"),
  ]);
  expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
  expect(results.filter((result) => result.duplicate)).toHaveLength(1);

  const persisted = await db.webhookEvent.findUnique({
    where: { provider_providerEventId: { provider: "ghl", providerEventId: receipt.providerEventId } },
  });
  expect(persisted).toMatchObject({
    provider: "ghl",
    eventType: "ContactCreate",
    locationId: "synthetic-location",
    entityId: "synthetic-contact",
    signatureOk: true,
    processingStatus: "RECEIVED",
    loopSuppressed: false,
  });
  expect(JSON.stringify(persisted?.payloadJson)).not.toContain("Synthetic Privacy Fixture");
  expect(JSON.stringify(persisted?.payloadJson)).not.toContain("synthetic-webhook@example.invalid");
});

it("rejects a previously seen delivery ID when its minimal event identity changes", async () => {
  const changed = parseGhlWebhookReceipt(Buffer.from(JSON.stringify({
    type: "ContactCreate",
    webhookId: eventId,
    locationId: "synthetic-location",
    id: "synthetic-other-contact",
  })));
  await expect(store.accept(changed)).rejects.toThrow(GhlWebhookConflictError);
});

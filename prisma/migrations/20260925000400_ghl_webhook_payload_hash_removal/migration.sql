-- Raw webhook bodies contain contact data; no unsalted body digest is retained.
ALTER TABLE "WebhookEvent" DROP COLUMN "payloadHash";

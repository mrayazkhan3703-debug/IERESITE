ALTER TABLE "WebhookEvent"
  ADD COLUMN "providerEventId" VARCHAR(200),
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "entityId" TEXT,
  ADD COLUMN "payloadHash" CHAR(64),
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "loopSuppressed" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key"
  ON "WebhookEvent"("provider", "providerEventId");

CREATE INDEX "WebhookEvent_provider_processingStatus_receivedAt_idx"
  ON "WebhookEvent"("provider", "processingStatus", "receivedAt");

ALTER TABLE "ImportRun"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "snapshotRetrievedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "ImportRun_idempotencyKey_key" ON "ImportRun"("idempotencyKey");

ALTER TABLE "ImportRunChunk"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "ImportRunChunk_status_leaseExpiresAt_idx" ON "ImportRunChunk"("status", "leaseExpiresAt");

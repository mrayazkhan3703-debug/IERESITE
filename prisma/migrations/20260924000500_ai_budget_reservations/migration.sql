ALTER TABLE "AiUsage"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN "reservedTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorCode" TEXT;

UPDATE "AiUsage"
SET "reservedTokens" = COALESCE("promptTokens", 0) + COALESCE("completionTokens", 0);

-- The retired Z.AI path stored character-based token and indicative currency
-- estimates as if they were provider measurements. Withdraw those claims.
UPDATE "AiUsage"
SET "promptTokens" = NULL,
    "completionTokens" = NULL,
    "costMicros" = NULL,
    "reservedTokens" = 0
WHERE "provider" = 'zai';

ALTER TABLE "AiUsage"
  ADD CONSTRAINT "AiUsage_status_check"
  CHECK ("status" IN ('RESERVED', 'SUCCEEDED', 'FAILED'));

CREATE INDEX "AiUsage_status_createdAt_idx" ON "AiUsage"("status", "createdAt");

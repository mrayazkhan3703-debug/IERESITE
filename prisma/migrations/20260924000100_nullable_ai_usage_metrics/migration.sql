-- Provider usage metadata can be unavailable, and Gemini does not return a billed-cost receipt.
-- NULL means unknown; do not present missing measurements as zero-cost/zero-token calls.
ALTER TABLE "AiUsage"
  ALTER COLUMN "promptTokens" DROP DEFAULT,
  ALTER COLUMN "promptTokens" DROP NOT NULL,
  ALTER COLUMN "completionTokens" DROP DEFAULT,
  ALTER COLUMN "completionTokens" DROP NOT NULL,
  ALTER COLUMN "costMicros" DROP DEFAULT,
  ALTER COLUMN "costMicros" DROP NOT NULL;

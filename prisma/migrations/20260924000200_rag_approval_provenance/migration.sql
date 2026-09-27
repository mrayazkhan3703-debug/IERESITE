ALTER TABLE "RagSource"
  ALTER COLUMN "verifiedAt" DROP NOT NULL,
  ALTER COLUMN "verifiedAt" DROP DEFAULT,
  ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "freshnessReviewDueAt" TIMESTAMPTZ(3);

ALTER TABLE "RagSource"
  ADD CONSTRAINT "RagSource_approval_provenance_check"
  CHECK (
    NOT "isApproved"
    OR (
      "trustTier" <> 'UNVERIFIED'
      AND "verifiedAt" IS NOT NULL
      AND "freshnessReviewDueAt" IS NOT NULL
      AND "freshnessReviewDueAt" > "verifiedAt"
    )
  );

-- Retire seeded legal/DLD summaries that were not ingested from a reviewed source snapshot.
UPDATE "RagSource"
SET "isActive" = FALSE,
    "isApproved" = FALSE,
    "verifiedAt" = NULL,
    "freshnessReviewDueAt" = NULL
WHERE "id" IN ('src-dld-open-data', 'src-uae-legislation');

UPDATE "RagDocument"
SET "status" = 'RETIRED'
WHERE "slug" IN (
  'golden-visa-property-thresholds',
  'dld-transfer-fees-buying',
  'escrow-offplan-protection',
  'dld-open-data-catalog'
);

-- Seeded legal/market editorial copy had no reviewed source evidence. Preserve it
-- for private Admin review, but remove public status and false verification claims.
UPDATE "ContentEntry"
SET "status" = 'DRAFT',
    "reviewWorkflowState" = 'NONE',
    "sourceName" = NULL,
    "sourceUrl" = NULL,
    "sourceVerifiedAt" = NULL,
    "freshnessReviewDueAt" = NULL,
    "publishedAt" = NULL
WHERE "slug" IN (
  'buying-in-dubai',
  'selling-in-dubai',
  'off-plan-explained',
  'golden-visa-guide',
  'international-buyers-guide',
  'rental-income-landlord-guide',
  'mortgage-financing-guide',
  'service-charges-explained',
  'off-plan-vs-secondary',
  'market-cycles-timing',
  'short-stay-vs-annual-rent',
  'service-charges-net-yield-decider',
  'reading-payment-plans-like-a-lender'
);

UPDATE "Faq"
SET "isActive" = FALSE
WHERE "id" IN ('faq-1', 'faq-2', 'faq-3', 'faq-4', 'faq-5', 'faq-6', 'faq-7', 'faq-8', 'faq-9', 'faq-10', 'faq-11');

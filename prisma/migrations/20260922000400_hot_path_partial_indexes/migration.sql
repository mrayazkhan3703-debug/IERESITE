-- Public browse: preserve requested publication order while filtering common
-- availability modes, with join/filter columns available from the index tuple.
CREATE INDEX "Listing_public_browse_idx"
  ON "Listing" ("listingType", "availabilityStatus", "publishedAt" DESC)
  INCLUDE ("propertyId", "priceMinor")
  WHERE "availabilityStatus" <> 'WITHDRAWN';

-- Fast membership checks when joining public listings to canonical properties.
CREATE INDEX "Property_public_live_id_idx"
  ON "Property" (id)
  WHERE "publicationStatus" = 'PUBLISHED' AND "deletedAt" IS NULL;

-- Map/radius requests should never scan draft, deleted, or coordinate-less rows.
CREATE INDEX "Property_public_live_geo_idx"
  ON "Property" USING GIST (geo)
  WHERE "publicationStatus" = 'PUBLISHED'
    AND "deletedAt" IS NULL
    AND geo IS NOT NULL;

-- Claim the next small due batch in order without sorting completed job history.
CREATE INDEX "JobRun_due_claim_idx"
  ON "JobRun" ("scheduledAt")
  WHERE status IN ('QUEUED', 'RETRYING');

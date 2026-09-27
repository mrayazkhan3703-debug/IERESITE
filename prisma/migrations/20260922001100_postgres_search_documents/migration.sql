CREATE TABLE "SearchDocument" (
  "listingId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "normalizedText")) STORED,
  "listingType" TEXT NOT NULL,
  "propertyType" TEXT NOT NULL,
  "bedrooms" DOUBLE PRECISION NOT NULL,
  "bathrooms" DOUBLE PRECISION NOT NULL,
  "areaSqft" DOUBLE PRECISION,
  "priceMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "priceQualifier" TEXT,
  "rentFrequency" TEXT,
  "availabilityStatus" TEXT NOT NULL,
  "offPlan" BOOLEAN NOT NULL,
  "isFeatured" BOOLEAN NOT NULL,
  "isExclusive" BOOLEAN NOT NULL,
  "furnished" BOOLEAN NOT NULL,
  "furnishing" TEXT,
  "communityId" TEXT NOT NULL,
  "communityName" TEXT NOT NULL,
  "communitySlug" TEXT NOT NULL,
  "communityAreaType" TEXT NOT NULL,
  "communityAvgPsqft" DOUBLE PRECISION,
  "communityYieldPct" DOUBLE PRECISION,
  "projectId" TEXT,
  "projectName" TEXT,
  "projectSlug" TEXT,
  "projectStatus" TEXT,
  "developerId" TEXT,
  "developerName" TEXT,
  "developerSlug" TEXT,
  "agentId" TEXT,
  "agentSlug" TEXT,
  "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "geo" geography(Point,4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
  ) STORED,
  "publishedAt" TIMESTAMPTZ(3),
  "handoverQuarter" TEXT,
  "view" TEXT,
  "coverUrl" TEXT,
  "coverAlt" TEXT,
  "coverWidth" INTEGER,
  "coverHeight" INTEGER,
  "paymentPlanDownPercent" DOUBLE PRECISION,
  "paymentPlanPostHandover" BOOLEAN,
  "isDemoData" BOOLEAN NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("listingId")
);

CREATE INDEX "SearchDocument_propertyId_idx" ON "SearchDocument"("propertyId");
CREATE INDEX "SearchDocument_listingType_availabilityStatus_idx" ON "SearchDocument"("listingType", "availabilityStatus");
CREATE INDEX "SearchDocument_communitySlug_idx" ON "SearchDocument"("communitySlug");
CREATE INDEX "SearchDocument_propertyType_idx" ON "SearchDocument"("propertyType");
CREATE INDEX "SearchDocument_developerSlug_idx" ON "SearchDocument"("developerSlug");
CREATE INDEX "SearchDocument_priceMinor_idx" ON "SearchDocument"("priceMinor");
CREATE INDEX "SearchDocument_bedrooms_idx" ON "SearchDocument"("bedrooms");
CREATE INDEX "SearchDocument_publishedAt_idx" ON "SearchDocument"("publishedAt");
CREATE INDEX "SearchDocument_search_vector_idx" ON "SearchDocument" USING GIN ("search_vector");
CREATE INDEX "SearchDocument_normalized_trgm_idx" ON "SearchDocument" USING GIN ("normalizedText" gin_trgm_ops);
CREATE INDEX "SearchDocument_geo_idx" ON "SearchDocument" USING GIST ("geo");
CREATE INDEX "SearchDocument_amenities_idx" ON "SearchDocument" USING GIN ("amenities");

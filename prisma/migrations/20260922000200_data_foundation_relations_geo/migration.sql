-- DropForeignKey
ALTER TABLE "Consent" DROP CONSTRAINT "Consent_subjectId_fkey";

-- DropIndex
DROP INDEX "Consent_subjectType_subjectId_idx";

-- DropIndex
DROP INDEX "PaymentPlanInstallment_paymentPlanId_sequence_idx";

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "geo" geography(Point,4326),
ADD COLUMN     "locationPrecision" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "locationSourceId" TEXT,
ADD COLUMN     "locationSourceType" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "geo" geography(Point,4326),
ADD COLUMN     "locationPrecision" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "locationSourceId" TEXT,
ADD COLUMN     "locationSourceType" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable: split the legacy polymorphic subject before removing it. Only
-- identifiers that satisfy the explicit target relation are migrated.
ALTER TABLE "Consent"
ADD COLUMN "contactId" TEXT,
ADD COLUMN "userId" TEXT;

UPDATE "Consent"
SET "userId" = "subjectId"
WHERE "subjectType" = 'USER'
  AND EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "Consent"."subjectId");

UPDATE "Consent"
SET "contactId" = "subjectId"
WHERE "subjectType" = 'CONTACT'
  AND EXISTS (SELECT 1 FROM "Contact" WHERE "Contact"."id" = "Consent"."subjectId");

ALTER TABLE "Consent" DROP COLUMN "subjectId";

-- AlterTable
ALTER TABLE "Developer" ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "geo" geography(Point,4326),
ADD COLUMN     "locationPrecision" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "locationSourceId" TEXT,
ADD COLUMN     "locationSourceType" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LocationBoundary" ADD COLUMN     "boundaryGeo" geography(Polygon,4326),
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "geo" geography(Point,4326),
ADD COLUMN     "locationPrecision" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "locationSourceId" TEXT,
ADD COLUMN     "locationSourceType" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "geo" geography(Point,4326),
ADD COLUMN     "locationPrecision" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN     "locationSourceId" TEXT,
ADD COLUMN     "locationSourceType" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalEntityId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalIdentity_entityKind_canonicalEntityId_idx" ON "ExternalIdentity"("entityKind", "canonicalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_entityKind_externalId_key" ON "ExternalIdentity"("provider", "entityKind", "externalId");

-- CreateIndex
CREATE INDEX "Building_geo_idx" ON "Building" USING GIST ("geo");

-- CreateIndex
CREATE INDEX "Community_geo_idx" ON "Community" USING GIST ("geo");

-- CreateIndex
CREATE INDEX "Consent_subjectType_userId_idx" ON "Consent"("subjectType", "userId");

-- CreateIndex
CREATE INDEX "Consent_subjectType_contactId_idx" ON "Consent"("subjectType", "contactId");

-- CreateIndex
CREATE INDEX "JobRun_status_leaseExpiresAt_idx" ON "JobRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Location_geo_idx" ON "Location" USING GIST ("geo");

-- CreateIndex
CREATE INDEX "LocationBoundary_boundaryGeo_idx" ON "LocationBoundary" USING GIST ("boundaryGeo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlanInstallment_paymentPlanId_sequence_key" ON "PaymentPlanInstallment"("paymentPlanId", "sequence");

-- At most one active assignment may exist per lead. Historical inactive
-- assignments remain available for audit and reporting.
CREATE UNIQUE INDEX "LeadAssignment_one_active_per_lead_key"
ON "LeadAssignment"("leadId")
WHERE "active" = true;

-- Coordinates are canonical scalar API fields. The triggers maintain their
-- queryable PostGIS representation without inventing missing coordinates.
CREATE OR REPLACE FUNCTION iere_sync_point_geography()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."lat" IS NULL OR NEW."lng" IS NULL THEN
    NEW."geo" := NULL;
  ELSE
    NEW."geo" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Property_sync_geo"
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Property"
FOR EACH ROW EXECUTE FUNCTION iere_sync_point_geography();
CREATE TRIGGER "Project_sync_geo"
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Project"
FOR EACH ROW EXECUTE FUNCTION iere_sync_point_geography();
CREATE TRIGGER "Community_sync_geo"
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Community"
FOR EACH ROW EXECUTE FUNCTION iere_sync_point_geography();
CREATE TRIGGER "Building_sync_geo"
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Building"
FOR EACH ROW EXECUTE FUNCTION iere_sync_point_geography();
CREATE TRIGGER "Location_sync_geo"
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Location"
FOR EACH ROW EXECUTE FUNCTION iere_sync_point_geography();

UPDATE "Property" SET "lat" = "lat";
UPDATE "Project" SET "lat" = "lat";
UPDATE "Community" SET "lat" = "lat";
UPDATE "Building" SET "lat" = "lat" WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;
UPDATE "Location" SET "lat" = "lat" WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

ALTER TABLE "Building" ADD CONSTRAINT "Building_coordinate_pair_check"
CHECK (("lat" IS NULL) = ("lng" IS NULL));
ALTER TABLE "Location" ADD CONSTRAINT "Location_coordinate_pair_check"
CHECK (("lat" IS NULL) = ("lng" IS NULL));
ALTER TABLE "Property" ADD CONSTRAINT "Property_coordinate_range_check"
CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "Project" ADD CONSTRAINT "Project_coordinate_range_check"
CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "Community" ADD CONSTRAINT "Community_coordinate_range_check"
CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "Building" ADD CONSTRAINT "Building_coordinate_range_check"
CHECK ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180));
ALTER TABLE "Location" ADD CONSTRAINT "Location_coordinate_range_check"
CHECK ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180));

-- CreateIndex
CREATE INDEX "Project_geo_idx" ON "Project" USING GIST ("geo");

-- CreateIndex
CREATE INDEX "Property_geo_idx" ON "Property" USING GIST ("geo");

-- AddForeignKey
ALTER TABLE "AgentLanguage" ADD CONSTRAINT "AgentLanguage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSpecialty" ADD CONSTRAINT "AgentSpecialty_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationBoundary" ADD CONSTRAINT "LocationBoundary_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiToolExecution" ADD CONSTRAINT "AiToolExecution_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Property" ADD COLUMN "sourceSnapshotJson" TEXT;
ALTER TABLE "Property" ADD COLUMN "editorOverridesJson" TEXT;
ALTER TABLE "Listing" ADD COLUMN "sourceSnapshotJson" TEXT;
ALTER TABLE "Listing" ADD COLUMN "editorOverridesJson" TEXT;

UPDATE "Property" AS property
SET "sourceSnapshotJson" = imported."rawJson"
FROM (
  SELECT DISTINCT ON ("propertyId") "propertyId", "rawJson"
  FROM "ImportRecord"
  WHERE "propertyId" IS NOT NULL
    AND "rawJson" IS NOT NULL
    AND "action" IN ('CREATED', 'UPDATED')
  ORDER BY "propertyId", "createdAt" DESC
) AS imported
WHERE property."id" = imported."propertyId"
  AND property."sourceType" = 'IMPORT'
  AND property."sourceSnapshotJson" IS NULL;

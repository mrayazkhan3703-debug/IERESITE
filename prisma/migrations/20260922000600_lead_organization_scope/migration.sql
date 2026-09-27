-- Attach legacy unscoped leads to the configured default organization. If no
-- default exists, rows remain unscoped and are deliberately invisible to all
-- non-owner resource policies.
UPDATE "Lead"
SET "organizationId" = (
  SELECT "id"
  FROM "Organization"
  WHERE "isDefault" = true
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "organizationId" IS NULL
  AND EXISTS (SELECT 1 FROM "Organization" WHERE "isDefault" = true);

CREATE INDEX "Lead_organizationId_createdAt_idx"
ON "Lead"("organizationId", "createdAt");

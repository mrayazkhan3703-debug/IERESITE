-- Existing provider/demo/legacy sources retain their recorded global ownership.
-- New company uploads are scoped explicitly; no source/content is reassigned.
ALTER TABLE "ImportSource" ADD COLUMN "ownerOrganizationId" TEXT;
CREATE INDEX "ImportSource_ownerOrganizationId_idx" ON "ImportSource"("ownerOrganizationId");
ALTER TABLE "ImportSource" ADD CONSTRAINT "ImportSource_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

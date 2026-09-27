ALTER TABLE "Property" ADD COLUMN "ownerOrganizationId" TEXT;
ALTER TABLE "Project" ADD COLUMN "ownerOrganizationId" TEXT;
ALTER TABLE "Developer" ADD COLUMN "ownerOrganizationId" TEXT;
ALTER TABLE "Community" ADD COLUMN "ownerOrganizationId" TEXT;

CREATE INDEX "Property_ownerOrganizationId_idx" ON "Property"("ownerOrganizationId");
CREATE INDEX "Project_ownerOrganizationId_idx" ON "Project"("ownerOrganizationId");
CREATE INDEX "Developer_ownerOrganizationId_idx" ON "Developer"("ownerOrganizationId");
CREATE INDEX "Community_ownerOrganizationId_idx" ON "Community"("ownerOrganizationId");

ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Developer" ADD CONSTRAINT "Developer_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Community" ADD CONSTRAINT "Community_ownerOrganizationId_fkey"
  FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

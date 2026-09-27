ALTER TABLE "RagSource"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedById" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(3);

ALTER TABLE "RagSource"
  ADD CONSTRAINT "RagSource_approval_actor_check"
  CHECK (NOT "isApproved" OR ("isActive" AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));

ALTER TABLE "RagDocument"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedById" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(3);

-- Old documents had no reviewer evidence. Keep their content, but require review again.
UPDATE "RagDocument"
SET "status" = 'DRAFT', "approvedById" = NULL, "approvedAt" = NULL
WHERE "status" = 'ACTIVE';

ALTER TABLE "RagDocument"
  ADD CONSTRAINT "RagDocument_active_review_check"
  CHECK ("status" <> 'ACTIVE' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));

CREATE TABLE "RagDocumentRevision" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RagDocumentRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RagDocumentRevision_documentId_version_key"
  ON "RagDocumentRevision"("documentId", "version");
CREATE INDEX "RagDocumentRevision_documentId_createdAt_idx"
  ON "RagDocumentRevision"("documentId", "createdAt");

ALTER TABLE "RagDocumentRevision"
  ADD CONSTRAINT "RagDocumentRevision_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "RagDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

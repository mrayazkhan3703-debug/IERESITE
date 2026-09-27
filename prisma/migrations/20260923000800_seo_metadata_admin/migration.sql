CREATE TABLE "SeoMetadataRevision" (
  "id" TEXT NOT NULL,
  "seoMetadataId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoMetadataRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeoMetadataRevision_seoMetadataId_fkey"
    FOREIGN KEY ("seoMetadataId") REFERENCES "SeoMetadata"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SeoMetadataRevision_seoMetadataId_version_key"
  ON "SeoMetadataRevision"("seoMetadataId", "version");
CREATE INDEX "SeoMetadataRevision_seoMetadataId_createdAt_idx"
  ON "SeoMetadataRevision"("seoMetadataId", "createdAt");

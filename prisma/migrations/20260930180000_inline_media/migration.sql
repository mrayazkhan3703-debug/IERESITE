ALTER TABLE "MediaAsset" ADD COLUMN "posterMediaId" TEXT;
CREATE TABLE "MediaDownloadGrant" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY, "mediaId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MediaDownloadGrant_expiresAt_idx" ON "MediaDownloadGrant"("expiresAt");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_posterMediaId_fkey"
  FOREIGN KEY ("posterMediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "MediaAsset_posterMediaId_idx" ON "MediaAsset"("posterMediaId");
ALTER TABLE "PropertyMedia" ADD COLUMN "altText" TEXT, ADD COLUMN "caption" TEXT;
ALTER TABLE "ProjectMedia" ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "altText" TEXT, ADD COLUMN "caption" TEXT;
-- Preserve existing first-image presentation for established projects.
UPDATE "ProjectMedia" SET "isCover" = true WHERE "id" IN (
  SELECT DISTINCT ON (pm."projectId") pm."id" FROM "ProjectMedia" pm
  JOIN "MediaAsset" ma ON ma."id" = pm."mediaId"
  WHERE pm."section" = 'GALLERY' AND ma."mimeType" LIKE 'image/%'
  ORDER BY pm."projectId", pm."sortOrder", pm."createdAt", pm."id"
);

ALTER TABLE "MediaAsset"
ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "MediaAsset_isPrivate_idx" ON "MediaAsset"("isPrivate");

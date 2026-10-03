-- Keep source upload checksums and all existing records unchanged.
-- Legacy stored hashes remain unknown until separately verified; do not invent a backfill.
ALTER TABLE "MediaAsset" ADD COLUMN "storageChecksum" VARCHAR(64);

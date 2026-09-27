ALTER TABLE "RagChunk"
  ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "embeddingVersion" TEXT;

-- Existing vectors were generated without a document-revision or algorithm marker.
-- Retain the rows for audit/rebuild, but fail closed until a reviewed document is reindexed.
UPDATE "RagChunk"
SET "documentVersion" = 0, "embeddingVersion" = NULL;

CREATE INDEX "RagChunk_documentId_documentVersion_sequence_idx"
  ON "RagChunk"("documentId", "documentVersion", "sequence");

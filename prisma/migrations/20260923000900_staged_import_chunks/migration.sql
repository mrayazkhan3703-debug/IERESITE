ALTER TABLE "ImportRun"
  ADD COLUMN "inputFormat" TEXT,
  ADD COLUMN "importMode" TEXT NOT NULL DEFAULT 'SNAPSHOT',
  ADD COLUMN "adapterKey" TEXT,
  ADD COLUMN "adapterVersion" INTEGER,
  ADD COLUMN "sourceVersion" TEXT,
  ADD COLUMN "snapshotSha256" VARCHAR(64),
  ADD COLUMN "snapshotRef" TEXT,
  ADD COLUMN "recordCursor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "chunkSize" INTEGER NOT NULL DEFAULT 250;

CREATE INDEX "ImportRun_status_createdAt_idx" ON "ImportRun"("status", "createdAt");

CREATE TABLE "ImportRunChunk" (
  "id" TEXT NOT NULL,
  "importRunId" TEXT NOT NULL,
  "chunkNumber" INTEGER NOT NULL,
  "firstRecordNumber" INTEGER NOT NULL,
  "lastRecordNumber" INTEGER NOT NULL,
  "recordsCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "checksum" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "error" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ImportRunChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportRunChunk_importRunId_chunkNumber_key" ON "ImportRunChunk"("importRunId", "chunkNumber");
CREATE INDEX "ImportRunChunk_importRunId_status_chunkNumber_idx" ON "ImportRunChunk"("importRunId", "status", "chunkNumber");

ALTER TABLE "ImportRecord"
  ADD COLUMN "recordNumber" INTEGER,
  ADD COLUMN "importRunChunkId" TEXT;

CREATE UNIQUE INDEX "ImportRecord_importRunId_recordNumber_key" ON "ImportRecord"("importRunId", "recordNumber");
ALTER TABLE "ImportRunChunk" ADD CONSTRAINT "ImportRunChunk_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_importRunChunkId_fkey"
  FOREIGN KEY ("importRunChunkId") REFERENCES "ImportRunChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

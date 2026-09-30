ALTER TABLE "ImportRun" ADD COLUMN "datasetKind" TEXT,
  ADD COLUMN "appliedAt" TIMESTAMPTZ(3), ADD COLUMN "appliedBy" TEXT;
CREATE INDEX "ImportRun_datasetKind_createdAt_idx" ON "ImportRun"("datasetKind", "createdAt");

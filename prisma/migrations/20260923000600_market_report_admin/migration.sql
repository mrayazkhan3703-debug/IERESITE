ALTER TABLE "MarketReport"
  ADD COLUMN "reviewWorkflowState" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "isIllustrative" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE "MarketReportRevision" (
  "id" TEXT NOT NULL,
  "marketReportId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketReportRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketReportRevision_marketReportId_fkey"
    FOREIGN KEY ("marketReportId") REFERENCES "MarketReport"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MarketReportRevision_marketReportId_version_key"
  ON "MarketReportRevision"("marketReportId", "version");
CREATE INDEX "MarketReportRevision_marketReportId_createdAt_idx"
  ON "MarketReportRevision"("marketReportId", "createdAt");

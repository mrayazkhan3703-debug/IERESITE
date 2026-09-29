ALTER TABLE "PropertyUnit"
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "sourceSnapshotJson" TEXT,
  ADD COLUMN "editorOverridesJson" TEXT;

CREATE UNIQUE INDEX "PropertyUnit_projectId_sourceKey_key"
  ON "PropertyUnit"("projectId", "sourceKey");

CREATE TABLE "PropertyUnitStatusHistory" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT,
  "changedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PropertyUnitStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PropertyUnitStatusHistory_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "PropertyUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PropertyUnitStatusHistory_unitId_createdAt_idx"
  ON "PropertyUnitStatusHistory"("unitId", "createdAt");

ALTER TABLE "Developer" ADD COLUMN "verificationEvidenceUrl" TEXT;

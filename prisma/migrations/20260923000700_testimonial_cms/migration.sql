ALTER TABLE "Testimonial"
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "verificationEvidenceRef" TEXT,
  ADD COLUMN "consentEvidenceRef" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Testimonial_status_verified_consentCapturedAt_idx"
  ON "Testimonial"("status", "verified", "consentCapturedAt");

CREATE TABLE "TestimonialRevision" (
  "id" TEXT NOT NULL,
  "testimonialId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestimonialRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestimonialRevision_testimonialId_fkey"
    FOREIGN KEY ("testimonialId") REFERENCES "Testimonial"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TestimonialRevision_testimonialId_version_key"
  ON "TestimonialRevision"("testimonialId", "version");
CREATE INDEX "TestimonialRevision_testimonialId_createdAt_idx"
  ON "TestimonialRevision"("testimonialId", "createdAt");

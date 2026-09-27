CREATE TABLE "ContentTranslationGroup" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentTranslationGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContentEntry" ADD COLUMN "translationGroupId" TEXT;

CREATE UNIQUE INDEX "ContentEntry_translationGroupId_locale_key"
  ON "ContentEntry"("translationGroupId", "locale");

ALTER TABLE "ContentEntry"
  ADD CONSTRAINT "ContentEntry_translationGroupId_fkey"
  FOREIGN KEY ("translationGroupId") REFERENCES "ContentTranslationGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

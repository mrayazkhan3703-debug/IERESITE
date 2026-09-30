ALTER TABLE "CareerOpening"
  ADD COLUMN "responsibilities" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "requirements" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "benefits" TEXT,
  ADD COLUMN "salaryDisclosure" VARCHAR(180),
  ADD COLUMN "applicationMethod" TEXT NOT NULL DEFAULT 'CONTACT',
  ADD COLUMN "applicationTarget" VARCHAR(2000),
  ADD COLUMN "opensAt" TIMESTAMPTZ(3),
  ADD COLUMN "seoTitle" VARCHAR(180),
  ADD COLUMN "seoDescription" VARCHAR(300),
  ADD CONSTRAINT "CareerOpening_application_method_check" CHECK ("applicationMethod" IN ('CONTACT', 'EMAIL', 'URL'));

-- The server's database owner connection controls access; browser clients must not read drafts or audit snapshots directly.
ALTER TABLE "SiteSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteSettingRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareerOpening" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareerOpeningRevision" ENABLE ROW LEVEL SECURITY;

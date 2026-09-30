CREATE TABLE "SiteSetting" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "settingsJson" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteSettingRevision" (
  "id" TEXT NOT NULL,
  "siteSettingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" VARCHAR(300),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteSettingRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareerOpening" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "title" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "employmentType" TEXT NOT NULL,
  "workplaceType" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reviewWorkflowState" TEXT NOT NULL DEFAULT 'NONE',
  "closesAt" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CareerOpening_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareerOpening_locale_check" CHECK ("locale" IN ('en', 'ar')),
  CONSTRAINT "CareerOpening_status_check" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'CLOSED', 'RETIRED')),
  CONSTRAINT "CareerOpening_review_state_check" CHECK ("reviewWorkflowState" IN ('NONE', 'PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED'))
);

CREATE TABLE "CareerOpeningRevision" (
  "id" TEXT NOT NULL,
  "careerOpeningId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "editedBy" TEXT,
  "changeNote" VARCHAR(300),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareerOpeningRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteSettingRevision_siteSettingId_version_key" ON "SiteSettingRevision"("siteSettingId", "version");
CREATE UNIQUE INDEX "CareerOpening_locale_slug_key" ON "CareerOpening"("locale", "slug");
CREATE INDEX "CareerOpening_status_locale_publishedAt_idx" ON "CareerOpening"("status", "locale", "publishedAt");
CREATE UNIQUE INDEX "CareerOpeningRevision_careerOpeningId_version_key" ON "CareerOpeningRevision"("careerOpeningId", "version");

ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_siteSettingId_fkey"
  FOREIGN KEY ("siteSettingId") REFERENCES "SiteSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareerOpeningRevision" ADD CONSTRAINT "CareerOpeningRevision_careerOpeningId_fkey"
  FOREIGN KEY ("careerOpeningId") REFERENCES "CareerOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key") VALUES ('rbac-permission-site-settings-update', 'site-settings:update')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."key" = 'ADMIN' AND permission."key" = 'site-settings:update'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

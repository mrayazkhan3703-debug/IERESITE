CREATE TABLE "UserInvitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "invitedBy" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX "UserInvitation_email_createdAt_idx" ON "UserInvitation"("email", "createdAt");
CREATE INDEX "UserInvitation_organizationId_createdAt_idx" ON "UserInvitation"("organizationId", "createdAt");
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedBy_fkey"
  FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('rbac-permission-user-invite', 'user:invite', 'Invite organization-scoped staff'),
  ('rbac-permission-user-update', 'user:update', 'Update organization-scoped staff roles and access')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."key" = 'ADMIN' AND permission."key" = 'user:read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."key" = 'ADMIN' AND permission."key" IN ('user:invite', 'user:update')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

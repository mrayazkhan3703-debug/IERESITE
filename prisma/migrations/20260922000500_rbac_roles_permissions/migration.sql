-- Database-backed RBAC bootstrap. Runtime authorization fails closed against
-- these grants; the application manifest must stay aligned with this migration.

INSERT INTO "Role" ("id", "key", "name") VALUES
  ('rbac-role-owner', 'OWNER', 'OWNER'),
  ('rbac-role-admin', 'ADMIN', 'ADMIN'),
  ('rbac-role-manager', 'MANAGER', 'MANAGER'),
  ('rbac-role-content-editor', 'CONTENT_EDITOR', 'CONTENT EDITOR'),
  ('rbac-role-agent', 'AGENT', 'AGENT'),
  ('rbac-role-analyst', 'ANALYST', 'ANALYST'),
  ('rbac-role-customer', 'CUSTOMER', 'CUSTOMER'),
  ('rbac-role-viewer', 'VIEWER', 'VIEWER')
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "Permission" ("id", "key") VALUES
  ('rbac-permission-all', '*'),
  ('rbac-permission-property-all', 'property:*'),
  ('rbac-permission-project-all', 'project:*'),
  ('rbac-permission-developer-all', 'developer:*'),
  ('rbac-permission-community-all', 'community:*'),
  ('rbac-permission-agent-all', 'agent:*'),
  ('rbac-permission-lead-all', 'lead:*'),
  ('rbac-permission-content-all', 'content:*'),
  ('rbac-permission-media-all', 'media:*'),
  ('rbac-permission-seo-all', 'seo:*'),
  ('rbac-permission-import-all', 'import:*'),
  ('rbac-permission-user-read', 'user:read'),
  ('rbac-permission-audit-read', 'audit:read'),
  ('rbac-permission-analytics-read', 'analytics:read'),
  ('rbac-permission-integration-read', 'integration:read'),
  ('rbac-permission-rag-all', 'rag:*'),
  ('rbac-permission-market-all', 'market:*'),
  ('rbac-permission-jobs-all', 'jobs:*'),
  ('rbac-permission-dlq-all', 'dlq:*'),
  ('rbac-permission-quality-all', 'quality:*'),
  ('rbac-permission-content-read', 'content:read'),
  ('rbac-permission-media-read', 'media:read'),
  ('rbac-permission-import-read', 'import:read'),
  ('rbac-permission-market-read', 'market:read'),
  ('rbac-permission-jobs-read', 'jobs:read'),
  ('rbac-permission-quality-read', 'quality:read'),
  ('rbac-permission-property-read', 'property:read'),
  ('rbac-permission-project-read', 'project:read'),
  ('rbac-permission-community-read', 'community:read'),
  ('rbac-permission-developer-read', 'developer:read'),
  ('rbac-permission-agent-read', 'agent:read'),
  ('rbac-permission-lead-read', 'lead:read'),
  ('rbac-permission-lead-update', 'lead:update'),
  ('rbac-permission-viewing-all', 'viewing:*'),
  ('rbac-permission-booking-read', 'booking:read'),
  ('rbac-permission-account-self', 'account:self')
ON CONFLICT ("key") DO NOTHING;

WITH grants("roleKey", "permissionKey") AS (VALUES
  ('OWNER', '*'),
  ('ADMIN', 'property:*'), ('ADMIN', 'project:*'), ('ADMIN', 'developer:*'),
  ('ADMIN', 'community:*'), ('ADMIN', 'agent:*'), ('ADMIN', 'lead:*'),
  ('ADMIN', 'content:*'), ('ADMIN', 'media:*'), ('ADMIN', 'seo:*'),
  ('ADMIN', 'import:*'), ('ADMIN', 'user:read'), ('ADMIN', 'audit:read'),
  ('ADMIN', 'analytics:read'), ('ADMIN', 'integration:read'), ('ADMIN', 'rag:*'),
  ('ADMIN', 'market:*'), ('ADMIN', 'jobs:*'), ('ADMIN', 'dlq:*'), ('ADMIN', 'quality:*'),
  ('MANAGER', 'property:*'), ('MANAGER', 'project:*'), ('MANAGER', 'developer:*'),
  ('MANAGER', 'community:*'), ('MANAGER', 'agent:*'), ('MANAGER', 'lead:*'),
  ('MANAGER', 'content:read'), ('MANAGER', 'media:read'), ('MANAGER', 'import:read'),
  ('MANAGER', 'audit:read'), ('MANAGER', 'analytics:read'), ('MANAGER', 'integration:read'),
  ('MANAGER', 'market:read'), ('MANAGER', 'jobs:read'), ('MANAGER', 'quality:read'),
  ('CONTENT_EDITOR', 'content:*'), ('CONTENT_EDITOR', 'media:*'),
  ('CONTENT_EDITOR', 'seo:*'), ('CONTENT_EDITOR', 'rag:*'), ('CONTENT_EDITOR', 'market:*'),
  ('CONTENT_EDITOR', 'property:read'), ('CONTENT_EDITOR', 'project:read'),
  ('CONTENT_EDITOR', 'community:read'), ('CONTENT_EDITOR', 'developer:read'),
  ('CONTENT_EDITOR', 'agent:read'),
  ('AGENT', 'lead:read'), ('AGENT', 'lead:update'), ('AGENT', 'property:read'),
  ('AGENT', 'project:read'), ('AGENT', 'viewing:*'), ('AGENT', 'booking:read'),
  ('ANALYST', 'analytics:read'), ('ANALYST', 'market:*'), ('ANALYST', 'property:read'),
  ('ANALYST', 'audit:read'), ('ANALYST', 'quality:read'),
  ('CUSTOMER', 'account:self'),
  ('VIEWER', 'property:read'), ('VIEWER', 'project:read'),
  ('VIEWER', 'content:read'), ('VIEWER', 'market:read')
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM grants
JOIN "Role" role ON role."key" = grants."roleKey"
JOIN "Permission" permission ON permission."key" = grants."permissionKey"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Earlier local fixtures may have granted analysts raw lead access. Analysts
-- use aggregate analytics only, so remove this sensitive grant explicitly.
DELETE FROM "RolePermission" role_permission
USING "Role" role, "Permission" permission
WHERE role_permission."roleId" = role."id"
  AND role_permission."permissionId" = permission."id"
  AND role."key" = 'ANALYST'
  AND permission."key" IN ('lead:read', 'lead:*');

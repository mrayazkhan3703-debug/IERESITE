DELETE FROM "RolePermission" role_permission
USING "Role" role, "Permission" permission
WHERE role_permission."roleId" = role."id"
  AND role_permission."permissionId" = permission."id"
  AND role."key" = 'ANALYST'
  AND permission."key" IN ('lead:read', 'lead:*', 'audit:read', 'audit:*');

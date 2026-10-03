import { PrismaClient } from "@prisma/client";
import { ROLE_PERMISSION_MANIFEST } from "../src/server/authz-policy";

/** Explicit first-install initialization; never creates demo or company content. */
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    for (const [key, permissions] of Object.entries(ROLE_PERMISSION_MANIFEST)) {
      const role = await tx.role.upsert({ where: { key }, create: { key, name: key.replace(/_/g, " ") }, update: {} });
      for (const key of permissions) {
        const permission = await tx.permission.upsert({ where: { key }, create: { key }, update: {} });
        await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, create: { roleId: role.id, permissionId: permission.id }, update: {} });
      }
    }
  }, { timeout: 60000 });
  console.log("Authorization initialized. No users or company/demo content created.");
} finally { await db.$disconnect(); }

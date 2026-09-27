import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Audit log (Q05): redacted before/after, actor, resource */
export const GET = apiHandler(async (req) => {
  const user = await requirePermission("audit:read");
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const resourceType = url.searchParams.get("resource") ?? undefined;

  const where = {
    ...(resourceType ? { resourceType } : {}),
    ...(!user.roles.includes("OWNER") ? { organizationId: user.organizationId ?? "__no_organization__" } : {}),
  };
  const [entries, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: (page - 1) * 25,
      include: { user: { select: { email: true, name: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    total,
    page,
    entries: entries.map((e) => ({
      id: e.id,
      actor: e.user?.email ?? e.actorType,
      actorType: e.actorType,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      before: e.beforeJson ? JSON.parse(e.beforeJson) : null,
      after: e.afterJson ? JSON.parse(e.afterJson) : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

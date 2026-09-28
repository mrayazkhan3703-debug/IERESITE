import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission, HttpError } from "@/server/auth";
import { db } from "@/lib/db";
import { indexStatus } from "@/server/search/service";
import { schedulerStatus } from "@/server/jobs/outbox";
import { readWorkerHealth } from "@/server/jobs/worker-health";
import { crmReconciliation } from "@/server/crm/adapter";
import { hasGrantedPermission } from "@/server/authz-policy";
import { leadRecordScope } from "@/server/domain/resource-policy";

export const dynamic = "force-dynamic";

/** Admin overview: KPIs for the operating dashboard (Q05/Q34) */
export const GET = apiHandler(async () => {
  const user = await requirePermission("analytics:read");
  if (!hasGrantedPermission(user.permissions, "lead:read")) {
    throw new HttpError(403, "The operating dashboard requires lead access", "FORBIDDEN");
  }
  const leadScope = leadRecordScope(user);
  const userScope = user.roles.includes("OWNER")
    ? {}
    : { organizationId: user.organizationId ?? "__no_organization__" };

  const [
    leadsTotal,
    leadsNew,
    leadsThisWeek,
    propertiesPublished,
    propertiesDraft,
    projectsCount,
    outboxPending,
    dlqCount,
    crm,
    index,
    jobs,
    aiUsage,
    eventCounts,
    openQualityIssues,
    activeUsers,
    worker,
  ] = await Promise.all([
    db.lead.count({ where: leadScope }),
    db.lead.count({ where: { AND: [leadScope, { status: "NEW" }] } }),
    db.lead.count({ where: { AND: [leadScope, { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }] } }),
    db.property.count({ where: { publicationStatus: "PUBLISHED", deletedAt: null } }),
    db.property.count({ where: { publicationStatus: "DRAFT" } }),
    db.project.count({ where: { publicationStatus: "PUBLISHED" } }),
    db.outboxEvent.count({ where: { publishedAt: null } }),
    db.deadLetterEvent.count({ where: { replayedAt: null } }),
    crmReconciliation(user.roles.includes("OWNER") ? undefined : user.organizationId),
    indexStatus(),
    schedulerStatus(),
    db.aiUsage.aggregate({ _sum: { costMicros: true, promptTokens: true, completionTokens: true }, _count: true }),
    db.analyticsEvent.groupBy({ by: ["name"], _count: true, orderBy: { _count: { name: "desc" } }, take: 12 }),
    db.dataQualityIssue.count({ where: { status: "OPEN" } }),
    db.user.count({ where: userScope }),
    readWorkerHealth(),
  ]);

  const recentLeads = await db.lead.findMany({
    where: leadScope,
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { contact: { select: { name: true, email: true, phoneE164: true } }, ownerAgent: { select: { name: true } } },
  });

  const jobStats = await db.jobRun.groupBy({ by: ["status"], _count: true });

  return NextResponse.json({
    kpis: {
      leadsTotal,
      leadsNew,
      leadsThisWeek,
      propertiesPublished,
      propertiesDraft,
      projectsCount,
      activeUsers,
      openQualityIssues,
      outboxPending,
      dlqCount,
      aiCostMicros: aiUsage._sum.costMicros,
      aiCalls: aiUsage._count,
      aiPromptTokens: aiUsage._sum.promptTokens,
      aiCompletionTokens: aiUsage._sum.completionTokens,
    },
    crm,
    searchIndex: index,
    jobs: { scheduler: jobs, worker, statusCounts: jobStats },
    topEvents: eventCounts.map((e) => ({ name: e.name, count: e._count })),
    recentLeads: recentLeads.map((l) => ({
      id: l.id,
      reference: l.id.slice(-8).toUpperCase(),
      intent: l.intent,
      status: l.status,
      contactName: l.contact.name,
      contactEmail: l.contact.email,
      contactPhone: l.contact.phoneE164,
      ownerAgent: l.ownerAgent?.name ?? null,
      entity: l.primaryEntityType,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

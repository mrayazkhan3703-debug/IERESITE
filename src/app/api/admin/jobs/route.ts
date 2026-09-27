import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { adminDeadLetterSelect, adminDeadLetterView, adminJobRunSelect, adminJobRunView, adminOutboxSelect, adminOutboxView } from "@/server/jobs/admin-read-model";

export const dynamic = "force-dynamic";

/** Job runs + outbox + DLQ monitoring (Q33 ops) */
export const GET = apiHandler(async (req) => {
  await requirePermission("jobs:read");
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const [runs, deadLetters, outboxPending, outboxRecent] = await Promise.all([
    db.jobRun.findMany({ select: adminJobRunSelect, orderBy: { createdAt: "desc" }, take: 20, skip: (page - 1) * 20 }),
    db.deadLetterEvent.findMany({ select: adminDeadLetterSelect, where: { replayedAt: null }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.outboxEvent.count({ where: { publishedAt: null } }),
    db.outboxEvent.findMany({ select: adminOutboxSelect, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return NextResponse.json({
    runs: runs.map(adminJobRunView),
    deadLetters: deadLetters.map(adminDeadLetterView),
    outbox: { pending: outboxPending, recent: outboxRecent.map(adminOutboxView) },
  });
});

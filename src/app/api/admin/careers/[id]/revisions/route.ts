import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("content:read");
  const { id } = await ctx.params;
  const revisions = await db.careerOpeningRevision.findMany({ where: { careerOpeningId: id }, orderBy: { version: "desc" }, take: 50 });
  return NextResponse.json({ revisions: revisions.map((revision) => {
    let snapshot: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(revision.snapshotJson); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) snapshot = parsed as Record<string, unknown>; } catch { /* preserve metadata while omitting malformed snapshots */ }
    return { version: revision.version, editedBy: revision.editedBy, changeNote: revision.changeNote, createdAt: revision.createdAt.toISOString(), snapshot };
  }) });
});

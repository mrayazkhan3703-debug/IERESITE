import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { db } from "@/lib/db";
import { rollbackContentDraft } from "@/server/domain/content-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("content:read");
  const { id } = await ctx.params;
  const entry = await db.contentEntry.findUnique({ where: { id }, select: { id: true } });
  if (!entry) return NextResponse.json({ error: "Content entry not found" }, { status: 404 });
  const revisions = await db.contentRevision.findMany({
    where: { contentEntryId: id }, orderBy: { version: "desc" }, take: 30,
    select: { id: true, version: true, snapshotJson: true, editedBy: true, changeNote: true, createdAt: true },
  });
  return NextResponse.json({ revisions: revisions.map((revision) => ({
    ...revision,
    snapshot: (() => { try { return JSON.parse(revision.snapshotJson); } catch { return null; } })(),
    snapshotJson: undefined,
    createdAt: revision.createdAt.toISOString(),
  })) });
});

const rollbackSchema = z.object({ revisionId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = rollbackSchema.parse(await jsonBody<z.infer<typeof rollbackSchema>>(req));
  return NextResponse.json(await rollbackContentDraft(actor, id, input.revisionId, input.expectedUpdatedAt, clientIp(req)));
});

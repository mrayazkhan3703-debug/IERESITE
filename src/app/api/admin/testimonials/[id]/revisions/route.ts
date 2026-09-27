import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { rollbackTestimonial } from "@/server/domain/testimonial-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("content:read");
  const { id } = await ctx.params;
  const revisions = await db.testimonialRevision.findMany({ where: { testimonialId: id }, orderBy: { version: "desc" }, take: 100 });
  return NextResponse.json({ revisions: revisions.map((revision) => {
    let snapshot: unknown = {};
    try { snapshot = JSON.parse(revision.snapshotJson); } catch { /* Keep malformed legacy history non-fatal and non-restorable. */ }
    return { id: revision.id, version: revision.version, snapshot, editedBy: revision.editedBy, changeNote: revision.changeNote, createdAt: revision.createdAt.toISOString() };
  }) });
});

const schema = z.object({ revisionId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await rollbackTestimonial(actor, id, input.revisionId, input.expectedUpdatedAt, clientIp(req)));
});

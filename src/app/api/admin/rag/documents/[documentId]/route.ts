import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { updateRagDocument } from "@/server/domain/rag-admin-command";
import { db } from "@/lib/db";
import { HttpError } from "@/server/auth";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ documentId: string }> }) => {
  await requirePermission("content:read");
  const { documentId } = await ctx.params;
  const document = await db.ragDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new HttpError(404, "Document not found", "NOT_FOUND");
  return NextResponse.json({ document }, { headers: { "Cache-Control": "private, no-store" } });
});

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ documentId: string }> }) => {
  const actor = await requirePermission("content:update");
  const { documentId } = await ctx.params;
  const schema = z.object({
    expectedUpdatedAt: z.string().datetime(),
    sourceId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(300),
    slug: z.string().trim().min(1).max(180),
    locale: z.enum(["en", "ar"]),
    content: z.string().min(41).max(50_000),
    changeNote: z.string().max(300).optional(),
  }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  const { expectedUpdatedAt, ...values } = input;
  return NextResponse.json(await updateRagDocument(actor, documentId, expectedUpdatedAt, values, clientIp(req)));
});

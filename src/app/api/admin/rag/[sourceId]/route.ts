import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { updateRagSource } from "@/server/domain/rag-admin-command";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ sourceId: string }> }) => {
  const actor = await requirePermission("content:update");
  const { sourceId } = await ctx.params;
  const schema = z.object({
    expectedUpdatedAt: z.string().datetime(),
    title: z.string().trim().min(1).max(240),
    sourceType: z.enum(["INTERNAL_DOC", "OFFICIAL", "NEWS", "REPORT", "GUIDE"]),
    canonicalUrl: z.string().max(2000).nullable().optional(),
    publisher: z.string().max(240).nullable().optional(),
    version: z.string().max(120).nullable().optional(),
    trustTier: z.enum(["INTERNAL", "OFFICIAL", "SECONDARY", "UNVERIFIED"]),
    verifiedAt: z.string().datetime(),
    freshnessReviewDueAt: z.string().datetime(),
    isActive: z.boolean(),
  }).strict();
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  const { expectedUpdatedAt, ...values } = input;
  return NextResponse.json(await updateRagSource(actor, sourceId, expectedUpdatedAt, values, clientIp(req)));
});

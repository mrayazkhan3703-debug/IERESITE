import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { reviewRagDocument } from "@/server/domain/rag-admin-command";

const schema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  decision: z.enum(["APPROVE", "CHANGES_REQUESTED", "RETIRE", "RESTORE"]),
  note: z.string().max(500).default(""),
}).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ documentId: string }> }) => {
  const actor = await requirePermission("content:update");
  const { documentId } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await reviewRagDocument(actor, documentId, input.expectedUpdatedAt, input.decision, input.note, clientIp(req)));
});

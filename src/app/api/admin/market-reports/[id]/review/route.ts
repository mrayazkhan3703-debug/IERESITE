import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { reviewMarketReport } from "@/server/domain/market-report-command";

export const dynamic = "force-dynamic";

const schema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  decision: z.enum(["APPROVE", "CHANGES_REQUESTED", "PUBLISH"]),
  note: z.string().max(1000).default(""),
}).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await reviewMarketReport(actor, id, input.expectedUpdatedAt, input.decision, input.note, clientIp(req)));
});

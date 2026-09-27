import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { publishTestimonial } from "@/server/domain/testimonial-command";

export const dynamic = "force-dynamic";

const schema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  verificationEvidenceRef: z.string().min(1).max(180),
  consentEvidenceRef: z.string().min(1).max(180),
  consentCapturedAt: z.string().datetime(),
  reviewNote: z.string().min(3).max(1000),
}).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await publishTestimonial(actor, id, input.expectedUpdatedAt, input, clientIp(req)));
});

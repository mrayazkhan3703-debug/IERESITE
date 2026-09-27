import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { retireTestimonial } from "@/server/domain/testimonial-command";

export const dynamic = "force-dynamic";

const schema = z.object({ expectedUpdatedAt: z.string().datetime(), restore: z.boolean() }).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("content:update");
  const { id } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await retireTestimonial(actor, id, input.expectedUpdatedAt, input.restore, clientIp(req)));
});

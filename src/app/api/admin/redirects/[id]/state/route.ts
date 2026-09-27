import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { setRedirectActiveCommand } from "@/server/domain/redirect-command";

export const dynamic = "force-dynamic";

const schema = z.object({ expectedUpdatedAt: z.string().datetime(), isActive: z.boolean() }).strict();

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requirePermission("seo:update");
  const { id } = await ctx.params;
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await setRedirectActiveCommand(actor, id, input.expectedUpdatedAt, input.isActive, clientIp(req)));
});

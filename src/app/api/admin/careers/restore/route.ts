import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { restoreCareerOpening } from "@/server/domain/career-command";

export const dynamic = "force-dynamic";
const schema = z.object({ careerOpeningId: z.string().min(1), expectedUpdatedAt: z.string().datetime() }).strict();
export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await restoreCareerOpening(actor, input.careerOpeningId, input.expectedUpdatedAt, clientIp(req)));
});

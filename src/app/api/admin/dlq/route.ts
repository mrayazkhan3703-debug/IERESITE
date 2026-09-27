import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { replayDeadLetterCommand } from "@/server/domain/dead-letter-command";

export const dynamic = "force-dynamic";

const replaySchema = z.object({ deadLetterId: z.string() });

/** DLQ replay (admin recovery action — PART M) */
export const POST = apiHandler(async (req) => {
  const user = await requirePermission("jobs:*");
  const raw = await jsonBody<z.infer<typeof replaySchema>>(req);
  const input = replaySchema.parse(raw);
  const result = await replayDeadLetterCommand(user, input.deadLetterId, clientIp(req));
  return NextResponse.json(result);
});

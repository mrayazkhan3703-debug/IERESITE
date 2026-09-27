import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { retireContentEntry } from "@/server/domain/content-command";

export const dynamic = "force-dynamic";

const schema = z.object({
  contentEntryId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  retire: z.boolean(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await retireContentEntry(actor, input.contentEntryId, input.expectedUpdatedAt, input.retire, clientIp(req)));
});

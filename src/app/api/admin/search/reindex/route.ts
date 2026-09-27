import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { requestSearchReindexCommand } from "@/server/domain/search-reindex-command";

export const dynamic = "force-dynamic";

/** Queue a recoverable full reindex through the durable worker outbox. */
export const POST = apiHandler(async (req) => {
  const user = await requirePermission("jobs:write");
  const result = await requestSearchReindexCommand(user, clientIp(req));
  return NextResponse.json(result, { status: 202 });
});

import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { requestSearchReindexCommand, directSearchReindexCommand } from "@/server/domain/search-reindex-command";

export const dynamic = "force-dynamic";

/** Queue a recoverable full reindex through the durable worker outbox. */
export const POST = apiHandler(async (req) => {
  const user = await requirePermission("jobs:write");
  const mode = req.headers.get("content-type")?.includes("application/json") ? z.object({ mode: z.enum(["queue", "direct"]).default("queue") }).parse(await jsonBody(req)).mode : "queue";
  if (mode === "direct") return NextResponse.json(await directSearchReindexCommand(user, clientIp(req)));
  const result = await requestSearchReindexCommand(user, clientIp(req));
  return NextResponse.json(result, { status: 202 });
});

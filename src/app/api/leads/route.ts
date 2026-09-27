import { NextResponse } from "next/server";
import { leadSubmitSchema, submitLead } from "@/server/domain/lead-service";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { grantedAnalyticsSessionId } from "@/server/privacy/analytics-attribution";

/** Lead submissions (leads + shared by other lead endpoints) */
export async function handleLeadSubmit(req: Request) {
  const raw = await jsonBody<Record<string, unknown>>(req);
  const input = leadSubmitSchema.parse(raw);
  const result = await submitLead(input, { attributionSessionId: await grantedAnalyticsSessionId(req) });
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
}

export const POST = apiHandler(handleLeadSubmit, { rateLimit: { limit: 10, windowMs: 3600_000, key: "lead" } });

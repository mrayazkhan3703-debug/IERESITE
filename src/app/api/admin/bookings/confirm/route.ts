import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { confirmBookingAdminCommand } from "@/server/domain/booking-admin-command";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  bookingId: z.string().min(1).max(100),
  expectedUpdatedAt: z.string().datetime(),
  evidenceSource: z.enum(["CUSTOMER_CONFIRMATION", "AGENT_CONFIRMATION", "PROVIDER_RECORD_REVIEWED"]),
  evidenceNote: z.string().trim().min(10).max(1000),
}).strict();

export const POST = apiHandler(async (request) => {
  const actor = await requirePermission("lead:update");
  const input = confirmSchema.parse(await jsonBody<z.infer<typeof confirmSchema>>(request));
  return NextResponse.json(await confirmBookingAdminCommand(actor, input, clientIp(request)));
}, { rateLimit: { limit: 20, windowMs: 60_000, key: "admin-booking-confirm" } });

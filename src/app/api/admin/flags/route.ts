import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { updateFeatureFlagCommand } from "@/server/domain/feature-flag-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requirePermission("property:read");
  return NextResponse.json({ flags: await db.featureFlag.findMany({ orderBy: { key: "asc" } }) });
});

const patchSchema = z.object({
  key: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  isEnabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
}).strict().refine((input) => input.isEnabled !== undefined || input.rolloutPercent !== undefined);

export const PATCH = apiHandler(async (req) => {
  const user = await requirePermission("property:*");
  const raw = await jsonBody<z.infer<typeof patchSchema>>(req);
  const input = patchSchema.parse(raw);
  return NextResponse.json(await updateFeatureFlagCommand(user, input, clientIp(req)));
});

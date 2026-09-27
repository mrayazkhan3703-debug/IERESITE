import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { clientIp } from "@/server/rate-limit";
import { passwordSchema } from "@/server/password-policy";
import { acceptUserInvitationCommand } from "@/server/domain/user-admin-command";

const acceptSchema = z.object({
  token: z.string().min(32).max(256),
  password: passwordSchema,
  name: z.string().trim().min(2).max(120).optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const input = acceptSchema.parse(await jsonBody<z.infer<typeof acceptSchema>>(req));
  const user = await acceptUserInvitationCommand(input, clientIp(req));
  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } }, { status: 201 });
}, { rateLimit: { key: "auth:accept-invite", limit: 10, windowMs: 60_000 } });

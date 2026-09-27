import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { consumeAccountToken } from "@/server/account-tokens";
import { audit, hashPassword } from "@/server/auth";
import { passwordSchema } from "@/server/password-policy";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ token: z.string().length(64), password: passwordSchema });

export const POST = apiHandler(async (req) => {
  const input = schema.parse(await jsonBody(req));
  const changed = await consumeAccountToken(input.token, "RESET_PASSWORD", async (tx, token) => {
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash: hashPassword(input.password), failedLogins: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId: token.userId } });
    await audit({ actorType: "USER", actorId: token.userId, action: "user.password_reset", resourceType: "user", resourceId: token.userId, ip: clientIp(req) }, tx);
    return true;
  });
  if (!changed) return NextResponse.json({ error: "Reset link is invalid or expired.", code: "INVALID_TOKEN" }, { status: 400 });
  return NextResponse.json({ changed: true });
});

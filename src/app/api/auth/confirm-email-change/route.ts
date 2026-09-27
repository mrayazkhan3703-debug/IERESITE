import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { consumeAccountToken } from "@/server/account-tokens";
import { audit, createSession, setSessionCookie } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ token: z.string().length(64) });

export const POST = apiHandler(async (req) => {
  const input = schema.parse(await jsonBody(req));
  const changed = await consumeAccountToken(input.token, "CHANGE_EMAIL", async (tx, token) => {
    if (!token.pendingValue) return null;
    const conflict = await tx.user.findUnique({ where: { email: token.pendingValue }, select: { id: true } });
    if (conflict && conflict.id !== token.userId) return null;
    const user = await tx.user.update({ where: { id: token.userId }, data: { email: token.pendingValue, emailVerified: new Date() }, select: { id: true, email: true, isActive: true } });
    await tx.session.deleteMany({ where: { userId: token.userId } });
    await audit({ actorType: "USER", actorId: user.id, action: "user.email_changed", resourceType: "user", resourceId: user.id, ip: clientIp(req) }, tx);
    return user.isActive ? user : null;
  });
  if (!changed) return NextResponse.json({ error: "Confirmation link is invalid, expired, or unavailable.", code: "INVALID_TOKEN" }, { status: 400 });
  const session = await createSession(changed.id, { userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
  await setSessionCookie(session);
  return NextResponse.json({ changed: true, email: changed.email, sessionsRevoked: true });
});

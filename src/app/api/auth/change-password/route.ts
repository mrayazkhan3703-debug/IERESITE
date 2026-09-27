import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, createSession, hashPassword, requireUser, setSessionCookie, verifyPassword, HttpError } from "@/server/auth";
import { passwordSchema } from "@/server/password-policy";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

export const POST = apiHandler(async (req) => {
  const sessionUser = await requireUser();
  const input = schema.parse(await jsonBody(req));
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: sessionUser.id }, select: { passwordHash: true } });
    if (!user?.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new HttpError(400, "Current password is incorrect", "INVALID_PASSWORD");
    }
    await tx.user.update({ where: { id: sessionUser.id }, data: { passwordHash: hashPassword(input.newPassword) } });
    await tx.session.deleteMany({ where: { userId: sessionUser.id } });
    await audit({ actorType: "USER", actorId: sessionUser.id, action: "user.password_changed", resourceType: "user", resourceId: sessionUser.id, ip: clientIp(req) }, tx);
  });
  const token = await createSession(sessionUser.id, { userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
  await setSessionCookie(token);
  return NextResponse.json({ changed: true, sessionsRevoked: true });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { consumeAccountToken } from "@/server/account-tokens";
import { audit, createSession, setSessionCookie } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ token: z.string().length(64) });

export const POST = apiHandler(async (req) => {
  const { token } = schema.parse(await jsonBody(req));
  const verified = await consumeAccountToken(token, "VERIFY_EMAIL", async (tx, accountToken) => {
    const user = await tx.user.update({
      where: { id: accountToken.userId },
      data: { emailVerified: new Date() },
      select: { id: true, email: true, isActive: true },
    });
    if (!user.isActive) return null;
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "user.email_verified",
      resourceType: "user",
      resourceId: user.id,
      ip: clientIp(req),
    }, tx);
    return user;
  });
  if (!verified) {
    return NextResponse.json({ error: "Verification link is invalid or expired.", code: "INVALID_TOKEN" }, { status: 400 });
  }
  const session = await createSession(verified.id, { userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
  await setSessionCookie(session);
  return NextResponse.json({ verified: true, email: verified.email });
});

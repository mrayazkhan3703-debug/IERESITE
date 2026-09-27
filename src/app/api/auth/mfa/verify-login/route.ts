import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { consumeAccountToken } from "@/server/account-tokens";
import { audit, createSession, setSessionCookie } from "@/server/auth";
import { verifyMfaOrRecoveryCode } from "@/server/mfa";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ challenge: z.string().length(64), code: z.string().min(6).max(32) });
class InvalidMfaCode extends Error {}

export const POST = apiHandler(async (req) => {
  const input = schema.parse(await jsonBody(req));
  let authenticated;
  try {
    authenticated = await consumeAccountToken(input.challenge, "MFA_LOGIN", async (tx, token) => {
      const user = await tx.user.findUnique({
        where: { id: token.userId },
        select: { id: true, email: true, isActive: true, mfaSecretCiphertext: true, mfaRecoveryCodesJson: true },
      });
      if (!user?.isActive || !user.mfaSecretCiphertext) throw new InvalidMfaCode();
      const valid = await verifyMfaOrRecoveryCode({
        tx,
        userId: user.id,
        secretCiphertext: user.mfaSecretCiphertext,
        recoveryCodesJson: user.mfaRecoveryCodesJson,
        code: input.code,
      });
      if (!valid) throw new InvalidMfaCode();
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await audit({ actorType: "USER", actorId: user.id, action: "user.login_mfa", resourceType: "user", resourceId: user.id, ip: clientIp(req) }, tx);
      return user;
    });
  } catch (error) {
    if (error instanceof InvalidMfaCode) {
      return NextResponse.json({ error: "The authentication code is invalid.", code: "INVALID_MFA_CODE" }, { status: 400 });
    }
    throw error;
  }
  if (!authenticated) return NextResponse.json({ error: "MFA challenge is invalid or expired.", code: "INVALID_CHALLENGE" }, { status: 400 });
  const session = await createSession(authenticated.id, { userAgent: req.headers.get("user-agent"), ip: clientIp(req), mfaVerified: true });
  await setSessionCookie(session);
  return NextResponse.json({ authenticated: true });
}, { rateLimit: { limit: 10, windowMs: 60_000, key: "mfa-login" } });

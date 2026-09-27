import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { consumeAccountToken } from "@/server/account-tokens";
import { audit, createSession, setSessionCookie } from "@/server/auth";
import { decryptMfaSecret, generateRecoveryCodes, verifyTotp } from "@/server/mfa";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ challenge: z.string().length(64), code: z.string().regex(/^\d{6}$/) });
class InvalidMfaCode extends Error {}

export const POST = apiHandler(async (req) => {
  const input = schema.parse(await jsonBody(req));
  let enrolled;
  try {
    enrolled = await consumeAccountToken(input.challenge, "MFA_SETUP", async (tx, token) => {
      if (!token.pendingValue) throw new InvalidMfaCode();
      const secret = decryptMfaSecret(token.pendingValue);
      if (!verifyTotp(secret, input.code)) throw new InvalidMfaCode();
      const recovery = generateRecoveryCodes();
      const user = await tx.user.update({
        where: { id: token.userId },
        data: {
          mfaSecretCiphertext: token.pendingValue,
          mfaEnabledAt: new Date(),
          mfaRecoveryCodesJson: JSON.stringify(recovery.hashes),
          failedLogins: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
        select: { id: true, email: true, isActive: true },
      });
      if (!user.isActive) throw new InvalidMfaCode();
      await tx.session.deleteMany({ where: { userId: user.id } });
      await audit({ actorType: "USER", actorId: user.id, action: "user.mfa_enabled", resourceType: "user", resourceId: user.id, ip: clientIp(req) }, tx);
      return { user, recoveryCodes: recovery.raw };
    });
  } catch (error) {
    if (error instanceof InvalidMfaCode) {
      return NextResponse.json({ error: "The authentication code is invalid.", code: "INVALID_MFA_CODE" }, { status: 400 });
    }
    throw error;
  }
  if (!enrolled) return NextResponse.json({ error: "MFA setup challenge is invalid or expired.", code: "INVALID_CHALLENGE" }, { status: 400 });
  const session = await createSession(enrolled.user.id, { userAgent: req.headers.get("user-agent"), ip: clientIp(req), mfaVerified: true });
  await setSessionCookie(session);
  return NextResponse.json({ enabled: true, recoveryCodes: enrolled.recoveryCodes });
}, { rateLimit: { limit: 10, windowMs: 60_000, key: "mfa-confirm" } });

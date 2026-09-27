import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, createSession, setSessionCookie, audit } from "@/server/auth";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { clientIp, rateLimit, logEvent } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";
import { issueAccountToken } from "@/server/account-tokens";
import { encryptMfaSecret, generateMfaSecret, requiresPrivilegedMfa } from "@/server/mfa";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(128),
});

export const POST = apiHandler(async (req) => {
  const ip = clientIp(req);
  const config = getConfig();
  const rl = rateLimit(`auth:${ip}`, config.RATE_LIMIT_AUTH_PER_MIN, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const body = await jsonBody<z.infer<typeof loginSchema>>(req);
  const { email, password } = loginSchema.parse(body);

  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !user.isActive || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    // uniform error (no user enumeration)
    if (user?.isActive) {
      await db.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 }, lockedUntil: user.failedLogins >= 9 ? new Date(Date.now() + 15 * 60_000) : undefined },
      }).catch(() => {});
    }
    logEvent("auth.login_failed");
    return NextResponse.json({ error: "Invalid email or password.", code: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "Account temporarily locked after repeated failed attempts. Try again later.", code: "LOCKED" }, { status: 423 });
  }
  if (!user.emailVerified) {
    return NextResponse.json({ error: "Email verification is required.", code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 403 });
  }

  const roles = user.roles.map((assignment) => assignment.role.key);
  if (requiresPrivilegedMfa(roles)) {
    if (!user.mfaSecretCiphertext || !user.mfaEnabledAt) {
      const pendingSecret = encryptMfaSecret(generateMfaSecret());
      const challenge = await issueAccountToken({
        userId: user.id,
        purpose: "MFA_SETUP",
        pendingValue: pendingSecret,
        ttlMinutes: 10,
      });
      return NextResponse.json({ mfaSetupRequired: true, challenge }, { status: 202 });
    }
    const challenge = await issueAccountToken({ userId: user.id, purpose: "MFA_LOGIN", ttlMinutes: 10 });
    return NextResponse.json({ mfaRequired: true, challenge }, { status: 202 });
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });

  const token = await createSession(user.id, { userAgent: req.headers.get("user-agent"), ip });
  await setSessionCookie(token);
  await audit({ actorType: "USER", actorId: user.id, action: "user.login", resourceType: "user", resourceId: user.id, ip });

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId, roles },
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/server/auth";
import { totpCode } from "@/server/mfa";

const baseUrl = process.env.TEST_BASE_URL ?? "http://web:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `mfa-http-user-${suffix}`;
const email = `mfa-http-${suffix}@example.invalid`;
const password = "MfaIntegration123";

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Expected session cookie");
  return cookie;
}

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("privileged MFA HTTP flow", () => {
  test("blocks unverified privileged sessions, enrolls TOTP, and consumes one recovery code", async () => {
    const owner = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
    const organization = await db.organization.findFirst({ where: { isDefault: true } });
    await db.user.create({
      data: {
        id: userId,
        email,
        passwordHash: hashPassword(password),
        emailVerified: new Date(),
        organizationId: organization?.id ?? null,
        roles: { create: { roleId: owner.id } },
      },
    });

    const bypassToken = await createSession(userId);
    const blocked = await fetch(`${baseUrl}/api/admin/analytics`, { headers: { cookie: `ie_session=${bypassToken}` } });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("MFA_REQUIRED");

    const login = await post("/api/auth/login", { email, password });
    expect(login.status).toBe(202);
    const loginBody = await login.json() as { mfaSetupRequired: boolean; challenge: string };
    expect(loginBody.mfaSetupRequired).toBe(true);

    const setup = await post("/api/auth/mfa/setup", { challenge: loginBody.challenge });
    expect(setup.status).toBe(200);
    const setupBody = await setup.json() as { secret: string };
    const confirm = await post("/api/auth/mfa/confirm", {
      challenge: loginBody.challenge,
      code: totpCode(setupBody.secret),
    });
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.json() as { recoveryCodes: string[] };
    expect(confirmBody.recoveryCodes).toHaveLength(10);
    const verifiedCookie = cookieFrom(confirm);

    const authorized = await fetch(`${baseUrl}/api/admin/analytics`, { headers: { cookie: verifiedCookie } });
    expect(authorized.status).toBe(200);

    const secondLogin = await post("/api/auth/login", { email, password });
    expect(secondLogin.status).toBe(202);
    const secondBody = await secondLogin.json() as { mfaRequired: boolean; challenge: string };
    expect(secondBody.mfaRequired).toBe(true);
    const recoveryLogin = await post("/api/auth/mfa/verify-login", {
      challenge: secondBody.challenge,
      code: confirmBody.recoveryCodes[0],
    });
    expect(recoveryLogin.status).toBe(200);
    expect(cookieFrom(recoveryLogin)).toStartWith("ie_session=");

    const updated = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaSecretCiphertext: true, mfaRecoveryCodesJson: true } });
    expect(updated.mfaSecretCiphertext).not.toContain(setupBody.secret);
    expect(JSON.parse(updated.mfaRecoveryCodesJson ?? "[]")).toHaveLength(9);
  });
});

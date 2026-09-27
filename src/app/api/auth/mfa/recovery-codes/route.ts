import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { generateRecoveryCodes, verifyMfaOrRecoveryCode } from "@/server/mfa";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ code: z.string().min(6).max(32) });

export const POST = apiHandler(async (req) => {
  const sessionUser = await requireUser();
  const { code } = schema.parse(await jsonBody(req));
  const recoveryCodes = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: sessionUser.id }, select: { mfaSecretCiphertext: true, mfaRecoveryCodesJson: true } });
    if (!user?.mfaSecretCiphertext) return null;
    const valid = await verifyMfaOrRecoveryCode({ tx, userId: sessionUser.id, secretCiphertext: user.mfaSecretCiphertext, recoveryCodesJson: user.mfaRecoveryCodesJson, code });
    if (!valid) return null;
    const replacement = generateRecoveryCodes();
    await tx.user.update({ where: { id: sessionUser.id }, data: { mfaRecoveryCodesJson: JSON.stringify(replacement.hashes) } });
    await audit({ actorType: "USER", actorId: sessionUser.id, action: "user.mfa_recovery_regenerated", resourceType: "user", resourceId: sessionUser.id, ip: clientIp(req) }, tx);
    return replacement.raw;
  });
  if (!recoveryCodes) return NextResponse.json({ error: "The authentication code is invalid.", code: "INVALID_MFA_CODE" }, { status: 400 });
  return NextResponse.json({ recoveryCodes });
});

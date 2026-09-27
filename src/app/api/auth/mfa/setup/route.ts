import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { getValidAccountToken } from "@/server/account-tokens";
import { db } from "@/lib/db";
import { decryptMfaSecret, mfaProvisioningUri } from "@/server/mfa";

const schema = z.object({ challenge: z.string().length(64) });

export const POST = apiHandler(async (req) => {
  const { challenge } = schema.parse(await jsonBody(req));
  const token = await getValidAccountToken(challenge, "MFA_SETUP");
  if (!token?.pendingValue) {
    return NextResponse.json({ error: "MFA setup challenge is invalid or expired.", code: "INVALID_CHALLENGE" }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { id: token.userId }, select: { email: true, isActive: true } });
  if (!user?.isActive) {
    return NextResponse.json({ error: "MFA setup challenge is invalid or expired.", code: "INVALID_CHALLENGE" }, { status: 400 });
  }
  const secret = decryptMfaSecret(token.pendingValue);
  return NextResponse.json({ secret, provisioningUri: mfaProvisioningUri(user.email, secret) });
}, { rateLimit: { limit: 10, windowMs: 60_000, key: "mfa-setup" } });

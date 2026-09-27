import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { issueAccountToken } from "@/server/account-tokens";
import { sendPasswordResetEmail } from "@/server/account-email";

const schema = z.object({ email: z.string().email().max(200) });

export const POST = apiHandler(async (req) => {
  const { email } = schema.parse(await jsonBody(req));
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (user?.isActive && user.emailVerified && user.passwordHash) {
    const token = await issueAccountToken({ userId: user.id, purpose: "RESET_PASSWORD", ttlMinutes: 30 });
    await sendPasswordResetEmail(user.email, token).catch(() => null);
  }
  return NextResponse.json({ accepted: true }, { status: 202 });
}, { rateLimit: { limit: 5, windowMs: 60_000, key: "forgot-password" } });

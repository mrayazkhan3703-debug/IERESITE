import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, requireUser, verifyPassword, HttpError } from "@/server/auth";
import { db } from "@/lib/db";
import { issueAccountToken } from "@/server/account-tokens";
import { sendEmailChangeConfirmation } from "@/server/account-email";
import { clientIp } from "@/server/rate-limit";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newEmail: z.string().email().max(200) });

export const POST = apiHandler(async (req) => {
  const sessionUser = await requireUser();
  const input = schema.parse(await jsonBody(req));
  const newEmail = input.newEmail.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { id: sessionUser.id }, select: { passwordHash: true, email: true } });
  if (!user?.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new HttpError(400, "Current password is incorrect", "INVALID_PASSWORD");
  }
  if (newEmail === user.email || await db.user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
    throw new HttpError(409, "That email address is unavailable", "EMAIL_UNAVAILABLE");
  }
  const token = await issueAccountToken({ userId: sessionUser.id, purpose: "CHANGE_EMAIL", pendingValue: newEmail, ttlMinutes: 30 });
  const delivery = await sendEmailChangeConfirmation(newEmail, token);
  await audit({ actorType: "USER", actorId: sessionUser.id, action: "user.email_change_requested", resourceType: "user", resourceId: sessionUser.id, after: { pendingEmail: newEmail }, ip: clientIp(req) });
  return NextResponse.json({ confirmationRequired: true, emailDelivery: delivery.accepted ? "accepted" : "not_configured" }, { status: 202 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, audit } from "@/server/auth";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";
import { issueAccountToken } from "@/server/account-tokens";
import { sendVerificationEmail } from "@/server/account-email";
import { passwordSchema } from "@/server/password-policy";

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: passwordSchema,
  name: z.string().min(2).max(120).optional(),
});

export const POST = apiHandler(async (req) => {
  const ip = clientIp(req);
  const rl = rateLimit(`auth:${ip}`, getConfig().RATE_LIMIT_AUTH_PER_MIN, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const body = await jsonBody<z.infer<typeof registerSchema>>(req);
  const parsed = registerSchema.parse(body);
  const email = parsed.email.trim().toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists.", code: "EMAIL_TAKEN" }, { status: 409 });
  }

  const user = await db.user.create({
    data: {
      email,
      name: parsed.name,
      passwordHash: hashPassword(parsed.password),
      profile: { create: {} },
      roles: {
        create: {
          role: { connect: { key: "CUSTOMER" } },
        },
      },
    },
    include: { roles: { include: { role: true } } },
  });

  const token = await issueAccountToken({ userId: user.id, purpose: "VERIFY_EMAIL", ttlMinutes: 24 * 60 });
  const delivery = await sendVerificationEmail(user.email, token);
  await audit({ actorType: "USER", actorId: user.id, action: "user.register", resourceType: "user", resourceId: user.id, ip });

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId, roles: user.roles.map((r) => r.role.key) },
    verificationRequired: true,
    emailDelivery: delivery.accepted ? "accepted" : "not_configured",
  }, { status: 201 });
});

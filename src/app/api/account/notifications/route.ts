import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Notification subscriptions + unread notifications for the account (Q27) */
export const GET = apiHandler(async () => {
  const user = await requireUser();
  const [subs, notifications] = await Promise.all([
    db.notificationSubscription.findMany({ where: { userId: user.id } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return NextResponse.json({
    subscriptions: subs.map((s) => ({ channel: s.channel, purpose: s.purpose, consentGrantedAt: s.consentGrantedAt?.toISOString() ?? null })),
    notifications: notifications.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

const putSchema = z.object({
  purpose: z.string().max(60),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS", "BROWSER"]).default("EMAIL"),
  enabled: z.boolean(),
});

/** Upsert a notification subscription (consent-based, revocable) */
export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const raw = await jsonBody<z.infer<typeof putSchema>>(req);
  const input = putSchema.parse(raw);

  if (input.enabled) {
    await db.notificationSubscription.upsert({
      where: { userId_channel_purpose: { userId: user.id, channel: input.channel, purpose: input.purpose } },
      create: { userId: user.id, channel: input.channel, purpose: input.purpose, consentGrantedAt: new Date() },
      update: { consentGrantedAt: new Date() },
    });
  } else {
    await db.notificationSubscription
      .deleteMany({ where: { userId: user.id, channel: input.channel, purpose: input.purpose } })
      .catch(() => {});
  }
  return NextResponse.json({ ok: true, purpose: input.purpose, enabled: input.enabled });
});

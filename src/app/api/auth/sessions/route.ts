import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, clearSessionCookie, requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";

export const GET = apiHandler(async () => {
  const user = await requireUser();
  const sessions = await db.session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, ipHash: true, createdAt: true, rotatedAt: true, expiresAt: true },
  });
  return NextResponse.json({
    sessions: sessions.map((session) => ({ ...session, current: session.id === user.sessionId })),
  });
});

const deleteSchema = z.object({ sessionId: z.string().optional(), allOther: z.boolean().optional() })
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.allOther), "Choose one session or all other sessions");

export const DELETE = apiHandler(async (req) => {
  const user = await requireUser();
  const input = deleteSchema.parse(await jsonBody(req));
  const where = input.allOther
    ? { userId: user.id, id: { not: user.sessionId } }
    : { userId: user.id, id: input.sessionId! };
  const removed = await db.session.deleteMany({ where });
  const revokedCurrent = input.sessionId === user.sessionId;
  if (revokedCurrent) await clearSessionCookie();
  await audit({ actorType: "USER", actorId: user.id, action: "user.sessions_revoked", resourceType: "session", resourceId: input.sessionId ?? "all-other", after: { count: removed.count }, ip: clientIp(req) });
  return NextResponse.json({ revoked: removed.count, currentSessionRevoked: revokedCurrent });
});

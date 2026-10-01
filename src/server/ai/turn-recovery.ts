import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/server/auth";
import type { AdvisorScope } from "./advisor";
import { ADVISOR_PROCESSING_MS } from "./turn-budget";

export function advisorRequestHash(message: string, locale: string, scope?: AdvisorScope) {
  return createHash("sha256").update(JSON.stringify([message, locale, scope?.propertySlug ?? null, scope?.projectSlug ?? null])).digest("hex");
}

/** Called only after the conversation owner has been checked. Never restarts an uncertain generation. */
export async function expireAdvisorTurns(conversationId: string, now = new Date()) {
  await db.aiTurn.updateMany({
    where: { conversationId, status: "PENDING", deadlineAt: { lt: new Date(now.getTime() - 15_000) } },
    data: { status: "FAILED", activeKey: null, errorCode: "PROVIDER_TIMEOUT", finishedAt: now },
  });
}

export async function claimAdvisorTurn(conversationId: string, clientRequestId: string, requestHash: string) {
  await expireAdvisorTurns(conversationId);
  const existing = await db.aiTurn.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new HttpError(409, "Request identifier belongs to a different message", "AI_REQUEST_CONFLICT");
    return { turn: existing, claimed: false };
  }
  try {
    const turn = await db.aiTurn.create({ data: {
      conversationId, clientRequestId, requestHash, activeKey: conversationId,
      deadlineAt: new Date(Date.now() + ADVISOR_PROCESSING_MS),
    } });
    return { turn, claimed: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const duplicate = await db.aiTurn.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId } } });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) throw new HttpError(409, "Request identifier belongs to a different message", "AI_REQUEST_CONFLICT");
      return { turn: duplicate, claimed: false };
    }
    throw new HttpError(409, "A reply is still being prepared. Recover that reply before sending another message.", "AI_TURN_BUSY");
  }
}

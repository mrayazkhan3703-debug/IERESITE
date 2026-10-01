import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { advisorRequestHash, claimAdvisorTurn } from "@/server/ai/turn-recovery";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { advisorTurn, ensureConversation } from "@/server/ai/advisor";
import { currentUser } from "@/server/auth";
import { getAiSessionHash } from "@/server/ai/session";
import { getConfig } from "@/lib/config";
import { clientIp, rateLimit } from "@/server/rate-limit";

const schema = z.object({
  message: z.string().min(1).max(1000),
  conversationId: z.string().max(64).optional(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  locale: z.enum(["en", "ar"]).default("en"),
  /* V2 §22 (U13): scoped conversation context — the advisor was entered from a
   * property or project page (?property= / ?project=). Server-side only: the
   * slug is resolved to real record facts and injected into the system prompt. */
  context: z
    .object({ propertySlug: z.string().max(120).optional(), projectSlug: z.string().max(120).optional() })
    .optional(),
});

export const POST = apiHandler(
  async (req) => {
    const config = getConfig();
    const user = await currentUser();
    const ip = clientIp(req);
    const sessionHash = user ? null : await getAiSessionHash(true);
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);
    const conversation = await ensureConversation(input.conversationId, user?.id, sessionHash, input.locale);
    const clientRequestId = input.clientRequestId ?? randomUUID();
    const { turn, claimed } = await claimAdvisorTurn(conversation.id, clientRequestId, advisorRequestHash(input.message, input.locale, input.context));
    if (!claimed) {
      if (turn.resultJson) return NextResponse.json(JSON.parse(turn.resultJson));
      if (turn.status === "PENDING") return NextResponse.json({ conversationId: conversation.id, clientRequestId, status: "PENDING" }, { status: 202, headers: { "Retry-After": "3" } });
      return NextResponse.json({ error: "This saved request did not complete. Reload your conversation before sending a new message.", code: turn.errorCode ?? "AI_TURN_FAILED", conversationId: conversation.id }, { status: 409 });
    }
    const rl = rateLimit(`ai:${user?.id ?? sessionHash ?? ip}`, config.AI_RATE_LIMIT_PER_HOUR, 3600_000);
    if (!rl.ok) {
      await db.aiTurn.update({ where: { id: turn.id }, data: { status: "FAILED", activeKey: null, errorCode: "RATE_LIMITED", finishedAt: new Date() } });
      return NextResponse.json({ error: "You've reached the AI advisor limit for this hour. Your conversation is saved. You can submit a separate consultation request; this chat has not been transferred.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    try {

    const result = await advisorTurn({
      conversationId: conversation.id,
      turnId: turn.id,
      deadlineAt: turn.deadlineAt.getTime(),
      userMessage: input.message,
      locale: input.locale,
      scope: input.context,
    });

    // The length-limit response bypasses generation; it still needs a durable receipt.
    await db.aiTurn.updateMany({ where: { id: turn.id, status: "PENDING" }, data: { status: "SUCCEEDED", activeKey: null, resultJson: JSON.stringify(result), finishedAt: new Date() } });
    return NextResponse.json(result);
    } catch (error) {
      await db.aiTurn.updateMany({ where: { id: turn.id, status: "PENDING" }, data: { status: "FAILED", activeKey: null, errorCode: "AI_TURN_FAILED", finishedAt: new Date() } }).catch(() => {});
      throw error;
    }

  },
  { rateLimit: { limit: 12, windowMs: 60_000, key: "aichat" } }
);

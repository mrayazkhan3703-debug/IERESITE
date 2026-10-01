import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/server/auth";
import { ensureConversation } from "@/server/ai/advisor";
import { getAiSessionHash } from "@/server/ai/session";

export const POST = apiHandler(async req => {
  const { locale } = z.object({ locale: z.enum(["en", "ar"]).default("en") }).parse(await jsonBody(req));
  const user = await currentUser();
  const sessionHash = user ? null : await getAiSessionHash(true);
  const conversation = await ensureConversation(undefined, user?.id, sessionHash, locale);
  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}, { rateLimit: { limit: 12, windowMs: 60_000, key: "ai-conversation-create" } });

export const dynamic = "force-dynamic";

/**
 * AI conversation list (U14 §24 — additive list endpoint). Only the signed-in
 * user's own conversations: id, status, topic/first-message snippet, message
 * count and timestamps. Full transcripts remain on
 * GET /api/ai/conversations/[id] with its owner check.
 */
export const GET = apiHandler(async () => {
  const user = await requireUser();
  const conversations = await db.aiConversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      topicSummary: true,
      messageCount: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => {
      const first = c.messages[0]?.content ?? null;
      return {
        id: c.id,
        status: c.status,
        topicSummary: c.topicSummary,
        firstMessage: first ? first.slice(0, 140) : null,
        messageCount: c.messageCount,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    }),
  });
});

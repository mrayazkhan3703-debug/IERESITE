import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";

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

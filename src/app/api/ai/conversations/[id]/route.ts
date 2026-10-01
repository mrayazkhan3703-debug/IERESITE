import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { expireAdvisorTurns } from "@/server/ai/turn-recovery";
import { db } from "@/lib/db";
import { currentUser } from "@/server/auth";
import { aiConversationOwnerWhere, getAiSessionHash } from "@/server/ai/session";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await currentUser();
  const sessionHash = user ? null : await getAiSessionHash(false);
  const owner = aiConversationOwnerWhere(user?.id, sessionHash);
  if (!owner) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const conversation = await db.aiConversation.findFirst({
    where: { id, ...owner },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 60 } },
  });
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  await expireAdvisorTurns(conversation.id);
  const turns = await db.aiTurn.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({
    turns: turns.map(turn => ({ clientRequestId: turn.clientRequestId, status: turn.status, deadlineAt: turn.deadlineAt.toISOString(), errorCode: turn.errorCode, result: turn.resultJson ? JSON.parse(turn.resultJson) : null })),
    id: conversation.id,
    status: conversation.status,
    handoff: conversation.status === "HANDED_OFF",
    messages: conversation.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        // tool trace: [{name,status},...] persisted by the advisor on assistant turns
        let toolNames: string[] | undefined;
        if (m.toolCallsJson) {
          try {
            const parsed = JSON.parse(m.toolCallsJson) as { name?: string }[];
            if (Array.isArray(parsed) && parsed.length) toolNames = parsed.map((t) => String(t.name));
          } catch {
            toolNames = undefined;
          }
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: safeCitations(m.citationsJson),
          toolNames,
          createdAt: m.createdAt.toISOString(),
        };
      }),
  });
});

function safeCitations(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.label === "string" && (item.url == null || typeof item.url === "string")) : undefined;
  } catch { return undefined; }
}

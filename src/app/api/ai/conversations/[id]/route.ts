import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
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
  return NextResponse.json({
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
          citations: m.citationsJson ? JSON.parse(m.citationsJson) : undefined,
          toolNames,
          createdAt: m.createdAt.toISOString(),
        };
      }),
  });
});

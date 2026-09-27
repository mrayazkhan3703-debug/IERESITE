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
    const rl = rateLimit(`ai:${user?.id ?? sessionHash ?? ip}`, config.AI_RATE_LIMIT_PER_HOUR, 3600_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "You've reached the AI advisor limit for this hour. Your conversation is saved — book a consultation and an advisor will continue where we left off.",
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);

    const conversation = await ensureConversation(input.conversationId, user?.id, sessionHash, input.locale);

    const result = await advisorTurn({
      conversationId: conversation.id,
      userMessage: input.message,
      locale: input.locale,
      scope: input.context,
    });

    return NextResponse.json({
      conversationId: result.conversationId,
      reply: result.reply,
      citations: result.citations,
      toolCalls: result.toolCalls,
      handoff: result.handoff,
      fallback: result.fallback,
      matches: result.matches ?? [],
      /* V2 (U13) — additive protocol fields; old clients ignore them safely. */
      attachments: result.attachments ?? [],
      searchCriteria: result.searchCriteria ?? null,
      handoffDetail: result.handoffDetail ?? null,
    });
  },
  { rateLimit: { limit: 12, windowMs: 60_000, key: "aichat" } }
);

import { mock } from "bun:test";
process.env.AI_USAGE_LIMIT_MODE = process.argv[3];
process.env.AI_PROVIDER = "mock";
process.env.AI_LIVE_ENABLED = "false";
mock.module("../../src/server/ai/gateway", () => ({ safeProviderFailureCode: () => "PROVIDER_FAILED", getChatProvider: () => ({ chat: async (request: { messages: unknown[] }) => {
  if (request.messages.length > 16) throw Error("Unbounded history");
  return { content: "No external model was called", promptTokens: null, completionTokens: null };
} }) }));
const { advisorTurn } = await import("../../src/server/ai/advisor");
const { db } = await import("../../src/lib/db");
try {
  const result = await advisorTurn({ conversationId: process.argv[2], userMessage: "Synthetic local long conversation check", locale: "ar" });
  console.log("LONG_EVIDENCE " + JSON.stringify({ reply: result.reply, fallback: result.fallback }));
} finally { await db.$disconnect(); }

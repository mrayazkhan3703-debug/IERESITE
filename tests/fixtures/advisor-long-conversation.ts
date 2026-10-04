process.env.AI_USAGE_LIMIT_MODE = process.argv[3];
process.env.AI_PROVIDER = "mock";
process.env.AI_LIVE_ENABLED = "false";
const { advisorTurn } = await import("../../src/server/ai/advisor");
const { db } = await import("../../src/lib/db");
try {
  const result = await advisorTurn({ conversationId: process.argv[2], userMessage: "Synthetic local long conversation check", locale: "ar" });
  console.log("LONG_EVIDENCE " + JSON.stringify({ reply: result.reply, fallback: result.fallback }));
} finally { await db.$disconnect(); }

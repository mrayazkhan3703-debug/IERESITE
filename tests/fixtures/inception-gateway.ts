// Run only in a fresh Bun subprocess: module mocks must not contaminate other tests.
import { mock } from "bun:test";
const mode = process.argv[2];
process.env.AI_PROVIDER = mode === "legacy" ? "gemini" : mode === "mock" ? "mock" : "inception";
process.env.INCEPTION_API_KEY = mode === "missing-key" ? "" : "synthetic-fixture-key";
process.env.INCEPTION_MODEL = "mercury-2.5";
process.env.AI_LIVE_ENABLED = mode === "disabled" ? "false" : "true";
process.env.AI_USAGE_LIMIT_MODE = mode.startsWith("unlimited") ? "unlimited" : "capped";
process.env.AI_DAILY_REQUEST_LIMIT = mode === "request-limit" ? "1" : "25";
process.env.AI_DAILY_TOKEN_LIMIT = mode === "token-limit" ? "1" : "60000";
process.env.AI_MAX_PROMPT_CHARS = mode === "prompt-limit" ? "1" : "48000";
process.env.DATABASE_URL = "postgresql://synthetic:synthetic@localhost/synthetic";
const rows: Record<string, unknown>[] = mode === "request-limit" || mode.startsWith("unlimited") ? [{ reservedTokens: 900000, promptTokens: null, completionTokens: null }] : [];
const aiUsage = {
  findMany: async () => rows,
  create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: String(rows.length), ...data }; rows.push(row); return row; },
  updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = rows.find(row => row.id === where.id); if (row) Object.assign(row, data); return { count: row ? 1 : 0 }; },
};
const fakeDb = { featureFlag: { findUnique: async () => ({ isEnabled: mode !== "kill", rolloutPercent: mode === "partial-rollout" ? 50 : 100 }) }, aiUsage,
  $queryRaw: async () => [{ requests: BigInt(rows.length), tokens: BigInt(rows.reduce((sum, row) => sum + Number(row.reservedTokens ?? 0), 0)) }],
  $transaction: async (operation: (tx: unknown) => unknown) => operation(fakeDb) };
mock.module("../../src/lib/db", () => ({ db: fakeDb }));
let calls = 0;
globalThis.fetch = Object.assign(async (url: RequestInfo | URL) => {
  calls++;
  if (String(url) !== "https://api.inceptionlabs.ai/v1/chat/completions") throw new Error("Unexpected network origin");
  if (mode === "retry" && calls === 1) return Response.json({ error: { code: "server_error" } }, { status: 503 });
  if (mode === "rate-limit") return Response.json({ error: { code: "rate_limit_reached", message: "private input" } }, { status: 429 });
  if (mode === "always-empty" || (mode === "empty-retry" && calls === 1)) return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Synthetic completion" } }], ...(mode === "unknown-usage" ? {} : { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }) });
}, { preconnect: fetch.preconnect });
const { getChatProvider, safeProviderFailureCode } = await import("@/server/ai/gateway");
let result: unknown = null, code: string | null = null;
try {
  result = await getChatProvider().chat({ messages: [{ role: "user", content: "Synthetic prompt" }], meta: { kind: mode === "nl-search" ? "NL_SEARCH" : mode === "rag" ? "RAG" : "CHAT" }, ...(mode === "expired" ? { deadlineAt: Date.now() - 1 } : {}) });
} catch (error) { code = error && typeof error === "object" && "code" in error ? String(error.code) : safeProviderFailureCode(error); }
console.log("GATEWAY_EVIDENCE " + JSON.stringify({ result, code, calls, rows }));

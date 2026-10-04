import { mock } from "bun:test";
process.env.AI_USAGE_LIMIT_MODE = process.argv[2].endsWith("capped") ? "capped" : "unlimited";
process.env.AI_RATE_LIMIT_PER_HOUR = "1";
process.env.DATABASE_URL = "postgresql://fixture:fixture@localhost/fixture";
const turns = new Map<string, Record<string, unknown>>(); let generations = 0;
mock.module("../../src/lib/db", () => ({ db: { community: { findMany: async () => [] }, aiTurn: {
  update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(turns.get(where.id)!, data),
  updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(turns.get(where.id)!, data); return { count: 1 }; },
} } }));
mock.module("../../src/server/auth", () => ({ HttpError: class extends Error {}, currentUser: async () => ({ id: "quota-fixture" }), errorResponse: () => Response.json({ code: "UNEXPECTED" }, { status: 500 }) }));
mock.module("../../src/server/ai/session", () => ({ getAiSessionHash: async () => null }));
mock.module("../../src/server/ai/advisor", () => ({ parseNlQuery: async () => { generations++; return { filters: {} }; }, ensureConversation: async () => ({ id: "fixture" }), advisorTurn: async () => { generations++; return { conversationId: "fixture", reply: "Synthetic answer", fallback: false }; } }));
mock.module("../../src/server/ai/turn-recovery", () => ({ advisorRequestHash: () => "fixture", claimAdvisorTurn: async (_id: string, key: string) => {
  if (turns.has(key)) return { claimed: false, turn: turns.get(key) };
  const turn = { id: key, status: "PENDING", deadlineAt: new Date(Date.now() + 60000) }; turns.set(key, turn); return { claimed: true, turn };
} }));
const nl = process.argv[2].startsWith("nl-");
const { POST } = nl ? await import("../../src/app/api/search/nl/route") : await import("../../src/app/api/ai/chat/route");
const realNow = Date.now; let time = realNow(); Date.now = () => time;
const statuses: number[] = [];
for (let i = 0; i < (process.argv[2].endsWith("burst") ? 13 : 70); i++) {
  const body = nl ? { query: "Synthetic query", locale: i % 2 ? "ar" : "en" } : { message: "Synthetic question", clientRequestId: "fixture-request-" + String(i).padStart(4, "0"), locale: i % 2 ? "ar" : "en" };
  const response = await POST(new Request("http://localhost/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify(body) }), undefined);
  statuses.push(response.status); if (!process.argv[2].endsWith("burst")) time += 6000;
}
const beforeReplay = generations;
time += 6000;
const replay = nl ? new Response() : await POST(new Request("http://localhost/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ message: "Synthetic question", clientRequestId: "fixture-request-0000" }) }), undefined);
Date.now = realNow;
console.log("QUOTA_EVIDENCE " + JSON.stringify({ statuses, generations, replayStatus: replay.status, replayGenerated: generations !== beforeReplay }));

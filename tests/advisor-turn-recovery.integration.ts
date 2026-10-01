import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { db } from "@/lib/db";
import { advisorRequestHash, claimAdvisorTurn, expireAdvisorTurns } from "@/server/ai/turn-recovery";
const prefix = "turn-recovery-" + crypto.randomUUID();
const hash = advisorRequestHash("Synthetic question", "en");
beforeAll(async () => { await db.aiConversation.create({ data: { id: prefix, sessionKey: "a".repeat(64) } }); });
afterAll(async () => { await db.aiConversation.delete({ where: { id: prefix } }); await db.$disconnect(); });
describe("durable Advisor generation", () => {
  test("concurrent duplicate requests claim exactly one generation", async () => {
    const results = await Promise.all([claimAdvisorTurn(prefix, "duplicate-request-1234", hash), claimAdvisorTurn(prefix, "duplicate-request-1234", hash)]);
    expect(results.filter(result => result.claimed)).toHaveLength(1);
    expect(results[0].turn.id).toBe(results[1].turn.id);
    expect(await db.aiTurn.count({ where: { conversationId: prefix } })).toBe(1);
  });
  test("changed messages and concurrent different turns are rejected", async () => {
    await expect(claimAdvisorTurn(prefix, "duplicate-request-1234", "b".repeat(64))).rejects.toMatchObject({ code: "AI_REQUEST_CONFLICT" });
    await expect(claimAdvisorTurn(prefix, "another-request-12345", hash)).rejects.toMatchObject({ code: "AI_TURN_BUSY" });
  });
  test("completed turns replay the saved result and never claim generation", async () => {
    const result = { reply: "Saved answer", conversationId: prefix, fallback: false, citations: [], toolCalls: [], handoff: false };
    await db.aiTurn.updateMany({ where: { conversationId: prefix }, data: { status: "SUCCEEDED", activeKey: null, resultJson: JSON.stringify(result), finishedAt: new Date() } });
    const replay = await claimAdvisorTurn(prefix, "duplicate-request-1234", hash);
    expect(replay.claimed).toBe(false); expect(JSON.parse(replay.turn.resultJson!)).toEqual(result);
  });
  test("stale uncertain requests expire without regenerating or blocking a new turn", async () => {
    const turn = await claimAdvisorTurn(prefix, "interrupted-request-1", hash);
    await db.aiTurn.update({ where: { id: turn.turn.id }, data: { deadlineAt: new Date(Date.now() - 90_000) } });
    await expireAdvisorTurns(prefix);
    const replay = await claimAdvisorTurn(prefix, "interrupted-request-1", hash);
    expect(replay.claimed).toBe(false); expect(replay.turn).toMatchObject({ status: "FAILED", activeKey: null, errorCode: "PROVIDER_TIMEOUT" });
    expect((await claimAdvisorTurn(prefix, "fresh-request-1234567", hash)).claimed).toBe(true);
  });
  test("conversation reads enforce anonymous ownership and mutation CSRF", async () => {
    const base = process.env.TEST_BASE_URL ?? "http://web:3000";
    expect((await fetch(base + "/api/ai/conversations/" + prefix)).status).toBe(404);
    expect((await fetch(base + "/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    const created = await fetch(base + "/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: '{"locale":"ar"}' });
    expect(created.status).toBe(201);
    const { conversationId } = await created.json() as { conversationId: string };
    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const read = await fetch(base + "/api/ai/conversations/" + conversationId, { headers: { cookie: cookie! } });
    expect(read.status).toBe(200); expect(await read.json()).toMatchObject({ id: conversationId, messages: [], turns: [] });
    await db.aiConversation.delete({ where: { id: conversationId } });
  });
});

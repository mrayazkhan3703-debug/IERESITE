import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

async function run(mode: string) {
  const child = Bun.spawn([process.execPath, resolve("tests/fixtures/inception-gateway.ts"), mode], { stdout: "pipe", stderr: "pipe" });
  const [out, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error("Isolated mock gateway fixture failed: " + error);
  const line = out.split("\n").find(row => row.startsWith("GATEWAY_EVIDENCE "));
  if (!line) throw new Error("Isolated gateway evidence missing");
  return JSON.parse(line.slice("GATEWAY_EVIDENCE ".length)) as { calls: number; code: string | null; result: { content: string; costMicros: number | null; model: string } | null; rows: { kind: string; status: string; reservedTokens: number; errorCode: string | null }[] };
}
describe("Inception gateway controls (isolated database and network mocks)", () => {
  test("unlimited mode sends a real-provider-shaped request past the daily budget and records usage", async () => {
    const evidence = await run("unlimited"); expect(evidence.code).toBeNull(); expect(evidence.calls).toBe(1);
    expect(evidence.rows).toHaveLength(2); expect(evidence.rows[1]).toMatchObject({ status: "SUCCEEDED", reservedTokens: 20 });
  });
  test("selected provider records known usage and no invented monetary cost", async () => {
    const evidence = await run("success"); expect(evidence.code).toBeNull(); expect(evidence.calls).toBe(1);
    expect(evidence.result).toMatchObject({ model: "mercury-2.5", costMicros: null }); expect(evidence.rows[0]).toMatchObject({ status: "SUCCEEDED", reservedTokens: 20 });
  });
  test("unknown usage retains conservative reservation", async () => {
    const evidence = await run("unknown-usage"); expect(evidence.rows[0].reservedTokens).toBeGreaterThan(1024); expect(evidence.rows[0].status).toBe("SUCCEEDED");
  });
  test("transient retry consumes a separate reservation inside the shared deadline", async () => {
    const evidence = await run("retry"); expect(evidence.calls).toBe(2); expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows[0]).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" }); expect(evidence.rows[0].reservedTokens).toBeGreaterThan(1024); expect(evidence.rows[1].status).toBe("SUCCEEDED");
  });
  test("429 is safely reported without retry or switching provider", async () => {
    const evidence = await run("rate-limit"); expect(evidence.calls).toBe(1); expect(evidence.code).toBe("PROVIDER_RATE_LIMITED"); expect(evidence.rows[0].status).toBe("FAILED");
  });
  test("empty success retries once and charges both completed provider attempts", async () => {
    const evidence = await run("empty-retry"); expect(evidence.calls).toBe(2); expect(evidence.code).toBeNull();
    expect(evidence.rows).toHaveLength(2); expect(evidence.rows[0]).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_OUTPUT_EMPTY", reservedTokens: 20 });
    expect(evidence.rows[1]).toMatchObject({ status: "SUCCEEDED", reservedTokens: 20 });
  });
  test("repeated empty success stops after the second charged attempt", async () => {
    const evidence = await run("always-empty"); expect(evidence.calls).toBe(2); expect(evidence.code).toBe("PROVIDER_OUTPUT_EMPTY");
    expect(evidence.rows).toHaveLength(2); for (const row of evidence.rows) expect(row).toMatchObject({ status: "FAILED", reservedTokens: 20 });
  });
  for (const [mode, code] of [["kill", "AI_KILL_SWITCH"], ["partial-rollout", "AI_KILL_SWITCH"], ["disabled", "AI_LIVE_DISABLED"], ["legacy", "AI_PROVIDER_NOT_APPROVED"], ["missing-key", "PROVIDER_CONFIG_MISSING"], ["request-limit", "AI_DAILY_REQUEST_LIMIT"], ["token-limit", "AI_DAILY_TOKEN_LIMIT"], ["prompt-limit", "AI_PROMPT_TOO_LARGE"], ["expired", "PROVIDER_TIMEOUT"]]) {
    test(`${mode} prevents external generation`, async () => { const evidence = await run(mode); expect(evidence.code).toBe(code); expect(evidence.calls).toBe(0); });
  }
  for (const [mode, kind] of [["nl-search", "NL_SEARCH"], ["rag", "RAG"]]) test(`${kind} shares the selected provider and usage controls`, async () => {
    const evidence = await run(mode); expect(evidence.calls).toBe(1); expect(evidence.result?.model).toBe("mercury-2.5"); expect(evidence.rows[0].kind).toBe(kind);
  });
  test("offline mock is provider-neutral and makes no external request", async () => {
    const evidence = await run("mock"); expect(evidence.calls).toBe(0); expect(evidence.rows).toHaveLength(0); expect(evidence.result?.content).toContain("No external model was called"); expect(evidence.result?.model).toBe("local-mock");
  });
});

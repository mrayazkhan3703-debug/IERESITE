import { expect, test } from "bun:test";
async function fixture(mode: string) {
  const child = Bun.spawn([process.execPath, "tests/fixtures/advisor-quota-route.ts", mode], { stdout: "pipe", stderr: "pipe" });
  const [out, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (status) throw Error("Quota fixture failed");
  return JSON.parse(out.split("\n").find(line => line.startsWith("QUOTA_EVIDENCE "))!.slice(15)) as { statuses: number[]; generations: number; replayStatus: number; replayGenerated: boolean };
}
test("unlimited bilingual requests pass former hourly quota and preserve replay", async () => {
  const result = await fixture("unlimited"); expect(result.statuses).toHaveLength(70); expect(result.statuses.every(status => status === 200)).toBe(true);
  expect(result.generations).toBe(70); expect(result.replayStatus).toBe(200); expect(result.replayGenerated).toBe(false);
});
test("capped mode still enforces hourly quota", async () => {
  const result = await fixture("capped"); expect(result.statuses[0]).toBe(200); expect(result.statuses[1]).toBe(429); expect(result.generations).toBe(1);
});
test("unlimited mode preserves twelve requests per minute burst throttle", async () => {
  const result = await fixture("burst"); expect(result.statuses.slice(0, 12).every(status => status === 200)).toBe(true); expect(result.statuses[12]).toBe(429);
});
test("natural-language search bypasses hourly quota only in unlimited mode and keeps burst throttle", async () => {
  const unlimited = await fixture("nl-unlimited"), capped = await fixture("nl-capped"), burst = await fixture("nl-burst");
  expect(unlimited.statuses.every(status => status === 200)).toBe(true); expect(unlimited.generations).toBe(70);
  expect(capped.statuses[1]).toBe(429); expect(burst.statuses[12]).toBe(429);
});

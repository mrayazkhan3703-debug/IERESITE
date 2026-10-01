import { describe, expect, test } from "bun:test";
import { requireTurnBudget, withinTurnBudget } from "@/server/ai/turn-budget";
import { advisorRequestHash } from "@/server/ai/turn-recovery";

describe("shared Advisor turn budget", () => {
  test("expired processing cannot start another provider or tool call", () => {
    expect(() => requireTurnBudget(Date.now() - 1)).toThrow("processing budget expired");
  });
  test("a stalled read is bounded by the remaining turn budget", async () => {
    await expect(withinTurnBudget(() => new Promise<never>(() => {}), Date.now() + 10)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(await withinTurnBudget(async () => "ready", Date.now() + 100)).toBe("ready");
  });
  test("request hashes preserve scope and locale without retaining the message", () => {
    const hash = advisorRequestHash("private question", "en", { propertySlug: "one", projectSlug: "two" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(advisorRequestHash("private question", "en", { projectSlug: "two", propertySlug: "one" }));
    expect(hash).not.toBe(advisorRequestHash("private question", "ar", { propertySlug: "one" }));
  });
});

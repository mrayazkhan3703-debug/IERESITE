import { describe, expect, test } from "bun:test";
import { containsAdvisorToolEnvelope } from "@/server/ai/tool-output";

describe("Advisor tool protocol never becomes a final answer", () => {
  test("recognizes the malformed Mercury response observed in Railway", () => {
    expect(containsAdvisorToolEnvelope('{"tool": "\n\n_knowledge", "args": {"query":"costs"}}')).toBe(true);
  });
  test("recognizes truncated and fenced tool envelopes without repairing them", () => {
    expect(containsAdvisorToolEnvelope('```json\n{"tool":"search_properties","args":{')).toBe(true);
    expect(containsAdvisorToolEnvelope('{"args": {}, "tool": "unknown"}')).toBe(true);
  });
  test("allows ordinary English and Arabic explanations and quoted tool names", () => {
    expect(containsAdvisorToolEnvelope('Use the search tool to find available listings.')).toBe(false);
    expect(containsAdvisorToolEnvelope('يرجى تحديد ميزانيتك وموقع العقار.')).toBe(false);
    expect(containsAdvisorToolEnvelope('The "tool" has not been run.')).toBe(false);
  });
});

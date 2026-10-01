import { expect, test } from "bun:test";
import { aiRetryDelay } from "@/server/ai/retry-policy";
test("one jittered upstream retry fits the same deadline", () => {
  expect(aiRetryDelay("PROVIDER_UNAVAILABLE", false, 20000, 0)).toBe(1000);
  expect(aiRetryDelay("PROVIDER_UNAVAILABLE", false, 20000, 1)).toBe(1500);
  expect(aiRetryDelay("PROVIDER_UNAVAILABLE", true, 20000)).toBeNull();
  expect(aiRetryDelay("PROVIDER_UNAVAILABLE", false, 4999)).toBeNull();
});
test("ambiguous timeout, auth, rate, malformed and budget failures do not retry", () => {
  for (const code of ["PROVIDER_TIMEOUT", "PROVIDER_NETWORK_FAILED", "PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_RESPONSE_INVALID", "PROVIDER_OUTPUT_TRUNCATED", "AI_DAILY_REQUEST_LIMIT"]) expect(aiRetryDelay(code, false, 60000)).toBeNull();
});

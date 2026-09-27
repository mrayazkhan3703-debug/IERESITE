import { describe, expect, it } from "bun:test";
import { redactLogData } from "@/server/rate-limit";

describe("structured event log redaction", () => {
  it("redacts exception text and sensitive nested fields while retaining safe metrics", () => {
    const safe = redactLogData({
      error: "provider failed for private.person@example.test, +971 50 123 4567",
      promptTokens: 42,
      completionTokens: 11,
      nested: { apiKey: "secret-key", userEmail: "private.person@example.test", ok: true },
      details: [{ message: "private note" }],
    });

    expect(safe).toEqual({
      error: "[REDACTED]",
      promptTokens: 42,
      completionTokens: 11,
      nested: { apiKey: "[REDACTED]", userEmail: "[REDACTED]", ok: true },
      details: [{ message: "[REDACTED]" }],
    });
    expect(JSON.stringify(safe)).not.toContain("private.person@example.test");
    expect(JSON.stringify(safe)).not.toContain("+971 50 123 4567");
  });

  it("masks contact patterns in otherwise safe string-valued fields and bounds nested values", () => {
    const safe = redactLogData({
      status: "failure reported to private.person@example.test at +971 50 123 4567",
      deeply: { nested: { data: { more: { private: "too deep" } } } },
    });

    expect(safe.status).toBe("failure reported to [EMAIL] at [PHONE]");
    expect(JSON.stringify(safe)).toContain("[OMITTED]");
  });
});

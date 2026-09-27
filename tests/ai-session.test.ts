import { describe, expect, it } from "bun:test";
import {
  aiConversationOwnerWhere,
  hashAiSessionToken,
  isAiSessionToken,
} from "@/server/ai/session";

describe("AI conversation session ownership", () => {
  it("accepts only a 32-byte base64url anonymous session token shape", () => {
    expect(isAiSessionToken("a".repeat(43))).toBe(true);
    expect(isAiSessionToken("short")).toBe(false);
    expect(isAiSessionToken("a".repeat(42) + "=" )).toBe(false);
  });

  it("hashes anonymous session tokens before database use", () => {
    const hash = hashAiSessionToken("opaque-browser-token");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("opaque-browser-token");
    expect(hashAiSessionToken("opaque-browser-token")).toBe(hash);
  });

  it("returns exactly one owner scope and rejects unbound anonymous access", () => {
    expect(aiConversationOwnerWhere("user-1", "a".repeat(64))).toEqual({ userId: "user-1", sessionKey: null });
    expect(aiConversationOwnerWhere(null, "b".repeat(64))).toEqual({ userId: null, sessionKey: "b".repeat(64) });
    expect(aiConversationOwnerWhere(null, null)).toBeNull();
    expect(aiConversationOwnerWhere(null, "not-a-hash")).toBeNull();
  });
});

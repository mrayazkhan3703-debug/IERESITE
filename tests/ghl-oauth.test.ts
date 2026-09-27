import { describe, expect, it } from "bun:test";
import type { AppConfig } from "@/lib/config";
import {
  beginGhlOAuth,
  completeGhlOAuthCallback,
  hashGhlOAuthState,
  isPrivilegedGhlAdmin,
  type GhlOAuthStateRecord,
  type GhlOAuthStateStore,
} from "@/server/crm/ghl-oauth";
import { ghlOAuthSettings, GHL_OAUTH_CALLBACK_PATH } from "@/server/crm/ghl-oauth-config";

class MemoryStateStore implements GhlOAuthStateStore {
  readonly records = new Map<string, GhlOAuthStateRecord>();

  async issue(record: GhlOAuthStateRecord) {
    this.records.set(record.stateHash, { ...record });
  }

  async consume(input: { stateHash: string; userId: string; sessionId: string; now: Date }) {
    const record = this.records.get(input.stateHash);
    if (!record || record.userId !== input.userId || record.sessionId !== input.sessionId || record.expiresAt <= input.now) return null;
    this.records.delete(input.stateHash);
    return record;
  }
}

describe("GHL Admin OAuth state lifecycle", () => {
  const actor = { id: "synthetic-admin", sessionId: "synthetic-session" };
  const installUrl = "https://marketplace.gohighlevel.com/oauth/install?client_id=synthetic&scope=contacts.readonly";
  const redirectUri = `http://localhost:3000${GHL_OAUTH_CALLBACK_PATH}`;

  it("issues an expiring session-bound state hash and preserves the configured install URL", async () => {
    const store = new MemoryStateStore();
    const started = await beginGhlOAuth(store, actor, { installUrl, redirectUri, now: 1000 });
    const url = new URL(started.authorizationUrl);
    const state = url.searchParams.get("state")!;

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("client_id")).toBe("synthetic");
    expect(url.searchParams.get("scope")).toBe("contacts.readonly");
    expect(store.records.has(hashGhlOAuthState(state))).toBe(true);
    expect(store.records.get(hashGhlOAuthState(state))).toMatchObject({
      userId: actor.id,
      sessionId: actor.sessionId,
      redirectUri,
      expiresAt: new Date(1000 + 10 * 60_000),
    });
    expect(started.authorizationUrl).not.toContain(hashGhlOAuthState(state));
  });

  it("requires the exact unexpired user/session state before exchanging once", async () => {
    const store = new MemoryStateStore();
    const started = await beginGhlOAuth(store, actor, { installUrl, redirectUri, now: 1000 });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const exchanges: Array<[string, string]> = [];
    const exchange = async (code: string, uri: string) => { exchanges.push([code, uri]); };

    const wrongSession = await completeGhlOAuthCallback(store, { ...actor, sessionId: "other-session" }, {
      state, code: "synthetic-code", providerError: null, now: 2000,
    }, exchange);
    expect(wrongSession.status).toBe("invalid");
    expect(exchanges).toHaveLength(0);

    const completed = await completeGhlOAuthCallback(store, actor, {
      state, code: "synthetic-code", providerError: null, now: 2000,
    }, exchange);
    expect(completed.status).toBe("connected");
    expect(exchanges).toEqual([["synthetic-code", redirectUri]]);

    const replay = await completeGhlOAuthCallback(store, actor, {
      state, code: "replayed-code", providerError: null, now: 2000,
    }, exchange);
    expect(replay.status).toBe("invalid");
    expect(exchanges).toHaveLength(1);
  });

  it("consumes provider cancellation and expired state without exchanging a code", async () => {
    const store = new MemoryStateStore();
    const cancelledStart = await beginGhlOAuth(store, actor, { installUrl, redirectUri, now: 1000 });
    const cancelledState = new URL(cancelledStart.authorizationUrl).searchParams.get("state")!;
    const exchange = async () => { throw new Error("exchange must not run"); };
    const cancelled = await completeGhlOAuthCallback(store, actor, {
      state: cancelledState, code: null, providerError: "access_denied", now: 2000,
    }, exchange);
    expect(cancelled.status).toBe("cancelled");
    expect(store.records.has(hashGhlOAuthState(cancelledState))).toBe(false);

    const expiredStart = await beginGhlOAuth(store, actor, { installUrl, redirectUri, now: 1000 });
    const expiredState = new URL(expiredStart.authorizationUrl).searchParams.get("state")!;
    const expired = await completeGhlOAuthCallback(store, actor, {
      state: expiredState, code: "expired-code", providerError: null, now: 1000 + 10 * 60_000,
    }, exchange);
    expect(expired.status).toBe("invalid");
  });

  it("refuses unsafe installation URLs and limits OAuth management to owner/admin", async () => {
    await expect(beginGhlOAuth(new MemoryStateStore(), actor, {
      installUrl: "http://attacker.invalid/install", redirectUri,
    })).rejects.toThrow("safe HTTPS URL");
    expect(isPrivilegedGhlAdmin({ roles: ["OWNER"] })).toBe(true);
    expect(isPrivilegedGhlAdmin({ roles: ["ADMIN"] })).toBe(true);
    expect(isPrivilegedGhlAdmin({ roles: ["MANAGER"] })).toBe(false);
  });

  it("accepts only configured canonical callback metadata", () => {
    const config = {
      APP_ENV: "development",
      APP_URL: "http://localhost:3000",
      GHL_CLIENT_ID: "synthetic-client",
      GHL_CLIENT_SECRET: "synthetic-secret",
      GHL_INSTALL_URL: installUrl,
      GHL_REDIRECT_URI: redirectUri,
      GHL_LOCATION_ID: "synthetic-location",
      CRM_TOKEN_ENCRYPTION_KEY: "b4".repeat(32),
    } as AppConfig;

    expect(ghlOAuthSettings(config).redirectUri).toBe(redirectUri);
    expect(() => ghlOAuthSettings({ ...config, GHL_REDIRECT_URI: "https://evil.invalid/callback" })).toThrow("canonical OAuth callback");
    expect(() => ghlOAuthSettings({ ...config, CRM_TOKEN_ENCRYPTION_KEY: "bad" })).toThrow("64-character hexadecimal");
    expect(() => ghlOAuthSettings({
      ...config,
      APP_ENV: "production",
      APP_URL: "https://iere.example.invalid",
      GHL_REDIRECT_URI: `https://iere.example.invalid${GHL_OAUTH_CALLBACK_PATH}`,
      GHL_INSTALL_URL: "http://localhost/install",
    })).toThrow("Production GHL installation URLs must use HTTPS");
  });
});

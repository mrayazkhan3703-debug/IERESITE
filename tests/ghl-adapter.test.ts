import { describe, expect, it } from "bun:test";
import { GhlCrmAdapter, GhlIdentityConflictError } from "@/server/crm/ghl-adapter";
import {
  createGhlAccessTokenProvider,
  GhlApiError,
  GhlHttpClient,
  type GhlApi,
  type GhlStoredTokens,
  type GhlTokenStore,
} from "@/server/crm/ghl-client";
import { decryptGhlTokens, encryptGhlTokens } from "@/server/crm/ghl-token-store";
import { verifiedGhlAgent, verifiedGhlAgentId } from "@/server/crm/ghl-agent-mapping";
import type { CrmLeadPayload } from "@/server/crm/adapter";

const samplePayload = (overrides: Partial<CrmLeadPayload["contact"]> = {}): CrmLeadPayload => ({
  leadId: "lead-local-001",
  reference: "LOCAL-001",
  intent: "INVEST",
  status: "NEW",
  sourceChannel: "WEBSITE",
  contact: { name: "Synthetic Contact", email: "sample@example.invalid", phoneE164: "+971500000001", dedupeKey: "synthetic", ...overrides },
  message: "This private message must not be sent to GHL.",
  entity: { type: "PROPERTY", id: "synthetic-property", slug: "synthetic-property", title: "Synthetic property" },
  attribution: {
    landingUrl: null, referrer: null, utmSource: null, utmMedium: null, utmCampaign: null,
    locale: "en", deviceClass: null,
  },
  assignment: { ownerAgentId: null, ownerAgentName: null, reason: null },
  consent: { contact: true, marketing: false, policyVersion: "test-policy" },
  submittedAt: "2026-09-25T00:00:00.000Z",
});

class FakeApi implements GhlApi {
  readonly calls: Array<{ path: string; options?: Parameters<GhlApi["request"]>[1] }> = [];
  constructor(private readonly responder: (path: string, options?: Parameters<GhlApi["request"]>[1]) => unknown) {}
  async request<T>(path: string, options?: Parameters<GhlApi["request"]>[1]): Promise<T> {
    this.calls.push({ path, options });
    return this.responder(path, options) as T;
  }
}

function noContactMatches() {
  return { contacts: [] };
}

describe("GoHighLevel adapter contracts", () => {
  it("fails before upsert when email and phone resolve to different contacts", async () => {
    const api = new FakeApi((path, options) => {
      if (path !== "/contacts/lookup") throw new Error("write must not happen after identity conflict");
      return options?.query?.email
        ? { contacts: [{ id: "contact-email", locationId: "location-verified" }] }
        : { contacts: [{ id: "contact-phone", locationId: "location-verified" }] };
    });
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified" });

    await expect(adapter.deliver(samplePayload(), "lead:local-001:v1")).rejects.toBeInstanceOf(GhlIdentityConflictError);
    expect(api.calls.map((call) => call.path)).toEqual(["/contacts/lookup", "/contacts/lookup"]);
  });

  it("rejects ambiguous lookup pages and missing contact consent without writes", async () => {
    const ambiguous = new FakeApi((path) => path === "/contacts/lookup"
      ? { contacts: [{ id: "c1" }, { id: "c2" }] }
      : { contacts: [] });
    const adapter = new GhlCrmAdapter(ambiguous, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    await expect(adapter.deliver(samplePayload({ phoneE164: null }), "lead:local-002:v1")).rejects.toBeInstanceOf(GhlIdentityConflictError);
    expect(ambiguous.calls).toHaveLength(1);

    const denied = new FakeApi(() => { throw new Error("no API call expected"); });
    const deniedAdapter = new GhlCrmAdapter(denied, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    await expect(deniedAdapter.deliver({ ...samplePayload(), consent: { contact: false, marketing: false, policyVersion: "test" } }, "lead:local-003:v1"))
      .rejects.toThrow("requires recorded contact consent");
    expect(denied.calls).toHaveLength(0);
  });

  it("maps minimal contact data and creates an opportunity without invented stage or owner IDs", async () => {
    const api = new FakeApi((path) => {
      if (path === "/contacts/lookup") return noContactMatches();
      if (path === "/contacts/upsert") return { new: true, contact: { id: "contact-created", locationId: "location-verified" } };
      if (path === "/opportunities/search") return { opportunities: [], meta: { total: 0 } };
      if (path === "/opportunities/") return { opportunity: { id: "opportunity-created" } };
      throw new Error(`unexpected mock route ${path}`);
    });
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    const result = await adapter.deliver(samplePayload(), "lead:local-004:v1");

    expect(result.externalId).toBe("opportunity-created");
    expect(result.response).toEqual({ contactId: "contact-created", opportunityId: "opportunity-created", opportunityStatus: "open", contactCreated: true, opportunityReused: false });
    const contactBody = api.calls.find((call) => call.path === "/contacts/upsert")?.options?.body as Record<string, unknown>;
    expect(contactBody).toMatchObject({ locationId: "location-verified", email: "sample@example.invalid", phone: "+971500000001", createNewIfDuplicateAllowed: false });
    expect(contactBody).not.toHaveProperty("tags");
    expect(JSON.stringify(contactBody)).not.toContain("private message");
    expect(JSON.stringify(contactBody)).not.toContain("contact: false");
    const opportunityBody = api.calls.find((call) => call.path === "/opportunities/")?.options?.body as Record<string, unknown>;
    expect(opportunityBody).toMatchObject({ locationId: "location-verified", pipelineId: "pipeline-verified", contactId: "contact-created", status: "open" });
    expect(opportunityBody).not.toHaveProperty("pipelineStageId");
    expect(opportunityBody).not.toHaveProperty("assignedTo");
    expect(String(opportunityBody.name)).toMatch(/^IERE-[a-f0-9]{24} INVEST$/);
  });

  it("creates opportunities with the approved terminal status and blocks unmapped SPAM before any request", async () => {
    const api = new FakeApi((path) => {
      if (path === "/contacts/lookup") return noContactMatches();
      if (path === "/contacts/upsert") return { new: true, contact: { id: "contact-created", locationId: "location-verified" } };
      if (path === "/opportunities/search") return { opportunities: [] };
      if (path === "/opportunities/") return { opportunity: { id: "opportunity-created" } };
      throw new Error(`unexpected mock route ${path}`);
    });
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    await adapter.deliver({ ...samplePayload(), status: "WON" }, "lead:local-won:v1");
    expect((api.calls.find((call) => call.path === "/opportunities/")?.options?.body as Record<string, unknown>).status).toBe("won");

    const denied = new FakeApi(() => { throw new Error("no API call expected for SPAM"); });
    await expect(new GhlCrmAdapter(denied, { locationId: "location-verified", pipelineId: "pipeline-verified" })
      .deliver({ ...samplePayload(), status: "SPAM" }, "lead:local-spam:v1"))
      .rejects.toThrow("SPAM status has no approved opportunity-status mapping");
    expect(denied.calls).toHaveLength(0);
  });

  it("updates only an explicit opportunity ID/status and requires confirmed provider success", async () => {
    const api = new FakeApi((path) => path === "/opportunities/opportunity-1/status" ? { success: true } : {});
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    await adapter.updateOpportunityStatus("opportunity-1", "won");
    expect(api.calls).toEqual([{
      path: "/opportunities/opportunity-1/status",
      options: { method: "PUT", body: { status: "won" } },
    }]);

    const unconfirmed = new GhlCrmAdapter(new FakeApi(() => ({ success: false })), { locationId: "location-verified", pipelineId: "pipeline-verified" });
    await expect(unconfirmed.updateOpportunityStatus("opportunity-1", "lost")).rejects.toThrow("did not confirm success");
  });

  it("reuses an exact existing opportunity marker on retries", async () => {
    const marker = `IERE-${await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lead:local-005:v1")).then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24))}`;
    const api = new FakeApi((path) => {
      if (path === "/contacts/lookup") return { contacts: [{ id: "contact-existing", locationId: "location-verified" }] };
      if (path === "/contacts/upsert") return { new: false, contact: { id: "contact-existing", locationId: "location-verified" } };
      if (path === "/opportunities/search") return { opportunities: [{ id: "opportunity-existing", name: `${marker} INVEST`, locationId: "location-verified", pipelineId: "pipeline-verified", contactId: "contact-existing" }] };
      if (path === "/opportunities/opportunity-existing/status") return { success: true };
      throw new Error("retry should not create a second opportunity");
    });
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified" });
    const result = await adapter.deliver(samplePayload(), "lead:local-005:v1");
    expect(result.externalId).toBe("opportunity-existing");
    expect((result.response as { opportunityReused: boolean }).opportunityReused).toBe(true);
    expect(api.calls.some((call) => call.path === "/opportunities/")).toBe(false);
    expect(api.calls.some((call) => call.path === "/opportunities/opportunity-existing/status")).toBe(true);
  });

  it("fails closed before provider writes when an assigned IERE agent has no verified mapping", async () => {
    const api = new FakeApi(() => { throw new Error("provider request must not happen"); });
    const adapter = new GhlCrmAdapter(api, { locationId: "location-verified", pipelineId: "pipeline-verified", resolveAgentUserId: async () => null });
    const payload = { ...samplePayload(), assignment: { ownerAgentId: "local-agent-1", ownerAgentName: "Local agent", reason: null } };

    await expect(adapter.deliver(payload, "lead:local-unmapped:v1")).rejects.toThrow("no verified GHL user mapping");
    expect(api.calls).toHaveLength(0);
  });

  it("sends only the verified GHL user ID as the opportunity owner", async () => {
    const api = new FakeApi((path) => {
      if (path === "/contacts/lookup") return noContactMatches();
      if (path === "/contacts/upsert") return { new: true, contact: { id: "contact-created", locationId: "location-verified" } };
      if (path === "/opportunities/search") return { opportunities: [], meta: { total: 0 } };
      if (path === "/opportunities/") return { opportunity: { id: "opportunity-created" } };
      throw new Error(`unexpected mock route ${path}`);
    });
    const adapter = new GhlCrmAdapter(api, {
      locationId: "location-verified", pipelineId: "pipeline-verified", resolveAgentUserId: async (agentId) => agentId === "local-agent-1" ? "ghl-user-verified" : null,
    });
    const payload = { ...samplePayload(), assignment: { ownerAgentId: "local-agent-1", ownerAgentName: "Local agent", reason: null } };

    await adapter.deliver(payload, "lead:local-mapped:v1");
    const opportunityBody = api.calls.find((call) => call.path === "/opportunities/")?.options?.body as Record<string, unknown>;
    expect(opportunityBody.assignedTo).toBe("ghl-user-verified");
    expect(opportunityBody.assignedTo).not.toBe(payload.assignment.ownerAgentId);
  });

  it("accepts an agent mapping only when provider identity and location membership are verified", () => {
    expect(verifiedGhlAgent({ id: "ghl-user-1", name: "Verified User", roles: { locationIds: ["location-verified"] } }, "ghl-user-1", "location-verified"))
      .toEqual({ id: "ghl-user-1", name: "Verified User" });
    expect(() => verifiedGhlAgent({ id: "ghl-user-1", roles: { locationIds: ["other-location"] } }, "ghl-user-1", "location-verified"))
      .toThrow("does not belong to the configured location");
    expect(verifiedGhlAgentId(JSON.stringify({ verified: true, locationId: "location-verified", ghlUserId: "ghl-user-1" }), "ghl-user-1", "location-verified"))
      .toBe("ghl-user-1");
    expect(verifiedGhlAgentId(JSON.stringify({ verified: true, locationId: "old-location", ghlUserId: "ghl-user-1" }), "ghl-user-1", "location-verified"))
      .toBeNull();
    expect(verifiedGhlAgentId(JSON.stringify({ verified: true, locationId: "location-verified", ghlUserId: "another-user" }), "ghl-user-1", "location-verified"))
      .toBeNull();
  });

  it("updates a safely matched opportunity owner on a retry", async () => {
    const marker = `IERE-${await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lead:local-owner-retry:v1")).then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24))}`;
    const api = new FakeApi((path) => {
      if (path === "/contacts/lookup") return { contacts: [{ id: "contact-existing", locationId: "location-verified" }] };
      if (path === "/contacts/upsert") return { new: false, contact: { id: "contact-existing", locationId: "location-verified" } };
      if (path === "/opportunities/search") return { opportunities: [{ id: "opportunity-existing", name: `${marker} INVEST`, locationId: "location-verified", pipelineId: "pipeline-verified", contactId: "contact-existing" }] };
      if (path === "/opportunities/opportunity-existing") return { opportunity: { id: "opportunity-existing" } };
      if (path === "/opportunities/opportunity-existing/status") return { success: true };
      throw new Error(`unexpected mock route ${path}`);
    });
    const adapter = new GhlCrmAdapter(api, {
      locationId: "location-verified", pipelineId: "pipeline-verified", resolveAgentUserId: async () => "ghl-user-verified",
    });
    const payload = { ...samplePayload(), assignment: { ownerAgentId: "local-agent-1", ownerAgentName: "Local agent", reason: null } };

    await adapter.deliver(payload, "lead:local-owner-retry:v1");
    const update = api.calls.find((call) => call.path === "/opportunities/opportunity-existing");
    expect(update?.options?.method).toBe("PUT");
    expect(update?.options?.body).toEqual({ assignedTo: "ghl-user-verified" });
  });
});

describe("GoHighLevel OAuth and HTTP client", () => {
  it("exchanges an authorization code through the fixed OAuth endpoint and installs location-scoped tokens", async () => {
    const store = new MemoryTokenStore(null);
    let capturedUrl = "";
    let capturedBody = new URLSearchParams();
    const tokens = createGhlAccessTokenProvider({
      clientId: "client-id", clientSecret: "client-secret", expectedLocationId: "location-verified", store, now: () => 100_000,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: "installed-access", refresh_token: "installed-refresh", expires_in: 3600, locationId: "location-verified", scope: "contacts.readonly" });
      },
    });

    await tokens.exchangeAuthorizationCode("one-time-code", "https://app.example.invalid/api/admin/integrations/ghl/callback");
    expect(capturedUrl).toBe("https://services.leadconnectorhq.com/oauth/token");
    expect(capturedBody.get("grant_type")).toBe("authorization_code");
    expect(capturedBody.get("redirect_uri")).toBe("https://app.example.invalid/api/admin/integrations/ghl/callback");
    expect(store.current).toEqual({ accessToken: "installed-access", refreshToken: "installed-refresh", expiresAt: 3_700_000, scope: "contacts.readonly", locationId: "location-verified" });
  });

  it("returns a valid stored access token without refreshing it", async () => {
    const store = new MemoryTokenStore({ accessToken: "cached-access", refreshToken: "cached-refresh", expiresAt: 900_000, scope: null, locationId: "location-verified" });
    let networkCalls = 0;
    const tokens = createGhlAccessTokenProvider({
      clientId: "client-id", clientSecret: "client-secret", store, now: () => 100_000,
      fetchImpl: async () => { networkCalls += 1; return new Response("unexpected", { status: 500 }); },
    });
    expect(await tokens.getAccessToken()).toBe("cached-access");
    expect(networkCalls).toBe(0);
  });

  it("refreshes under the store lock and atomically saves rotated tokens", async () => {
    const store = new MemoryTokenStore({ accessToken: "expired-access", refreshToken: "old-refresh", expiresAt: 99_000, scope: "contacts.readonly", locationId: "location-verified" });
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody = "";
    const tokens = createGhlAccessTokenProvider({
      clientId: "client-id", clientSecret: "client-secret", store, now: () => 100_000, refreshSkewMs: 0,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        capturedBody = String(init?.body);
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "contacts.readonly" });
      },
    });

    expect(await tokens.getAccessToken()).toBe("new-access");
    expect(capturedUrl).toBe("https://services.leadconnectorhq.com/oauth/token");
    expect(capturedHeaders.get("Version")).toBe("v3");
    expect(new URLSearchParams(capturedBody).get("refresh_token")).toBe("old-refresh");
    expect(new URLSearchParams(capturedBody).get("client_secret")).toBe("client-secret");
    expect(store.current).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", locationId: "location-verified" });
    expect(store.refreshLocks).toBe(1);
  });

  it("sends versioned bearer requests and does not expose provider error bodies", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    const client = new GhlHttpClient({ getAccessToken: async () => "unit-access-token" }, async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response("private CRM response body and token", { status: 403 });
    });
    let error: unknown;
    try {
      await client.request("/contacts/lookup", { query: { locationId: "location-verified", email: "sample@example.invalid" } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GhlApiError);
    expect((error as Error).message).toContain("HTTP 403");
    expect((error as Error).message).not.toContain("private CRM response body");
    expect(capturedUrl).toContain("locationId=location-verified");
    expect(capturedHeaders.get("Authorization")).toBe("Bearer unit-access-token");
    expect(capturedHeaders.get("Version")).toBe("v3");
    await expect(client.request("https://evil.example/path")).rejects.toThrow("safe absolute path");
  });
});

class MemoryTokenStore implements GhlTokenStore {
  refreshLocks = 0;
  constructor(public current: GhlStoredTokens | null) {}

  async read() {
    return this.current ? { ...this.current } : null;
  }

  async install(tokens: GhlStoredTokens) {
    this.current = { ...tokens };
  }

  async withRefreshLock<T>(work: (current: GhlStoredTokens | null, save: (tokens: GhlStoredTokens) => Promise<void>) => Promise<T>) {
    this.refreshLocks += 1;
    return work(this.current ? { ...this.current } : null, async (tokens) => { this.current = { ...tokens }; });
  }
}

describe("GHL OAuth credential envelope", () => {
  const key = "a7".repeat(32);
  const tokens: GhlStoredTokens = {
    accessToken: "synthetic-access-secret",
    refreshToken: "synthetic-refresh-secret",
    expiresAt: 1_800_000_000_000,
    scope: "contacts.readonly",
    locationId: "location-verified",
  };

  it("encrypts tokens with location-bound authenticated encryption", () => {
    const encrypted = encryptGhlTokens(tokens, "location-verified", key);
    expect(encrypted).not.toContain(tokens.accessToken);
    expect(encrypted).not.toContain(tokens.refreshToken);
    expect(decryptGhlTokens(encrypted, "location-verified", key)).toEqual(tokens);
    expect(() => decryptGhlTokens(encrypted, "another-location", key)).toThrow("could not be decrypted");
  });

  it("refuses tampered envelopes and invalid encryption keys", () => {
    const encrypted = encryptGhlTokens(tokens, "location-verified", key);
    const parts = encrypted.split(":");
    // Changing the last base64 character can change only ignored padding bits.
    // Flip an actual ciphertext byte so this always tests authenticated tampering.
    const corrupted = Buffer.from(parts[3], "base64url");
    corrupted[0] ^= 1;
    parts[3] = corrupted.toString("base64url");
    expect(() => decryptGhlTokens(parts.join(":"), "location-verified", key)).toThrow("could not be decrypted");
    expect(() => encryptGhlTokens(tokens, "location-verified", "short")).toThrow("64-character hexadecimal");
  });
});

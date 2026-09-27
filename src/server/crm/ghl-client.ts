/** Credential-free HighLevel API transport and rotating OAuth token boundary. */

export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "v3";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REFRESH_SKEW_MS = 120_000;

/** Narrow injection contract keeps deterministic fetch mocks independent of Bun-only helpers. */
export type GhlFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GhlStoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string | null;
  locationId: string | null;
}

/**
 * Production stores must serialize refreshes across web/worker processes and
 * atomically persist the rotated refresh token. Secrets must never be logged.
 */
export interface GhlTokenStore {
  read(): Promise<GhlStoredTokens | null>;
  install(tokens: GhlStoredTokens): Promise<void>;
  withRefreshLock<T>(
    work: (current: GhlStoredTokens | null, save: (tokens: GhlStoredTokens) => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

export interface GhlAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GhlOAuthTokenProvider extends GhlAccessTokenProvider {
  /** Call only after a one-time server-side OAuth state check. */
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<void>;
}

export interface GhlOAuthConfig {
  clientId: string;
  clientSecret: string;
  expectedLocationId?: string;
  store: GhlTokenStore;
  fetchImpl?: GhlFetch;
  now?: () => number;
  timeoutMs?: number;
  refreshSkewMs?: number;
}

function isUsable(tokens: GhlStoredTokens, now: number, skewMs: number): boolean {
  return Boolean(tokens.accessToken.trim()) && Number.isFinite(tokens.expiresAt) && tokens.expiresAt > now + skewMs;
}

/** Refreshes through an injected, transaction-safe store; no token persistence is implicit. */
export function createGhlAccessTokenProvider(options: GhlOAuthConfig): GhlOAuthTokenProvider {
  const clientId = options.clientId.trim();
  const clientSecret = options.clientSecret.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const expectedLocationId = options.expectedLocationId?.trim() || undefined;

  if (!clientId || !clientSecret) throw new Error("GHL OAuth client credentials are not configured");

  async function requestToken(body: URLSearchParams): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string | null; locationId: string | null }> {
    let response: Response;
    try {
      response = await fetchImpl(`${GHL_API_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", Version: API_VERSION },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error("GHL OAuth token request failed");
    }
    if (!response.ok) throw new Error(`GHL OAuth token request failed (HTTP ${response.status})`);

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error("GHL OAuth token response was invalid");
    }
    if (!result || typeof result !== "object") throw new Error("GHL OAuth token response was invalid");

    const tokenResponse = result as Record<string, unknown>;
    const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token.trim() : "";
    const refreshToken = typeof tokenResponse.refresh_token === "string" ? tokenResponse.refresh_token.trim() : "";
    const expiresIn = tokenResponse.expires_in;
    if (!accessToken || !refreshToken || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("GHL OAuth token response is missing required token fields");
    }
    const locationId = typeof tokenResponse.locationId === "string" ? tokenResponse.locationId : null;
    if (expectedLocationId && locationId && locationId !== expectedLocationId) {
      throw new Error("GHL OAuth returned a different location than configured");
    }
    return {
      accessToken,
      refreshToken,
      expiresIn,
      scope: typeof tokenResponse.scope === "string" ? tokenResponse.scope : null,
      locationId,
    };
  }

  return {
    async exchangeAuthorizationCode(code: string, redirectUri: string) {
      const authorizationCode = code.trim();
      if (!authorizationCode) throw new Error("GHL OAuth authorization code is required");
      const uri = new URL(redirectUri);
      if ((uri.protocol !== "https:" && uri.hostname !== "localhost") || uri.username || uri.password || uri.hash) {
        throw new Error("GHL OAuth redirect URI is invalid");
      }
      const response = await requestToken(new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: uri.toString(),
        user_type: "Location",
      }));
      if (!response.locationId || (expectedLocationId && response.locationId !== expectedLocationId)) {
        throw new Error("GHL OAuth response is missing the configured location ID");
      }
      await options.store.install({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: now() + response.expiresIn * 1000,
        scope: response.scope,
        locationId: response.locationId,
      });
    },

    async getAccessToken() {
      const stored = await options.store.read();
      if (!stored) throw new Error("GHL OAuth connection is not configured");
      if (isUsable(stored, now(), refreshSkewMs)) return stored.accessToken;

      return options.store.withRefreshLock(async (current, save) => {
        if (!current) throw new Error("GHL OAuth connection is not configured");
        if (isUsable(current, now(), refreshSkewMs)) return current.accessToken;
        if (!current.refreshToken.trim()) throw new Error("GHL OAuth refresh token is unavailable");

        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          user_type: "Location",
        });
        const response = await requestToken(body);
        if (current.locationId && response.locationId && current.locationId !== response.locationId) {
          throw new Error("GHL OAuth refresh returned a different location");
        }
        const rotated: GhlStoredTokens = {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresAt: now() + response.expiresIn * 1000,
          scope: response.scope ?? current.scope,
          locationId: response.locationId ?? current.locationId,
        };
        await save(rotated);
        return rotated.accessToken;
      });
    },
  };
}

export interface GhlApiRequestOptions {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface GhlApi {
  request<T>(path: string, options?: GhlApiRequestOptions): Promise<T>;
}

export class GhlApiError extends Error {
  constructor(readonly status: number, readonly path: string) {
    super(`GHL API request failed (HTTP ${status})`);
    this.name = "GhlApiError";
  }
}

/** Fixed-host API client: callers can select a path but cannot override the host. */
export class GhlHttpClient implements GhlApi {
  constructor(
    private readonly tokens: GhlAccessTokenProvider,
    private readonly fetchImpl: GhlFetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async request<T>(path: string, options: GhlApiRequestOptions = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//") || path.split("/").includes("..")) {
      throw new Error("GHL API path must be a safe absolute path");
    }
    const url = new URL(path.slice(1), `${GHL_API_BASE_URL}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const headers = new Headers({
      accept: "application/json",
      Authorization: `Bearer ${await this.tokens.getAccessToken()}`,
      Version: API_VERSION,
    });
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      signal: options.signal
        ? AbortSignal.any([AbortSignal.timeout(this.timeoutMs), options.signal])
        : AbortSignal.timeout(this.timeoutMs),
    };
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new Error("GHL API request failed before a response was received");
    }
    if (!response.ok) throw new GhlApiError(response.status, path);
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch {
      throw new Error("GHL API returned an invalid JSON response");
    }
  }
}

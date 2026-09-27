import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type SessionUser } from "@/server/auth";

export const GHL_OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface GhlOAuthStateRecord {
  stateHash: string;
  userId: string;
  sessionId: string;
  redirectUri: string;
  expiresAt: Date;
}

export interface GhlOAuthStateStore {
  issue(record: GhlOAuthStateRecord): Promise<void>;
  consume(input: { stateHash: string; userId: string; sessionId: string; now: Date }): Promise<GhlOAuthStateRecord | null>;
}

export interface GhlOAuthActor {
  id: string;
  sessionId: string;
}

export class PrismaGhlOAuthStateStore implements GhlOAuthStateStore {
  constructor(private readonly client: PrismaClient = db) {}

  async issue(record: GhlOAuthStateRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.ghlOAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      await tx.ghlOAuthState.create({ data: record });
      await audit({
        actorId: record.userId,
        action: "ghl.oauth.start",
        resourceType: "integration",
        resourceId: "ghl",
        after: { expiresAt: record.expiresAt.toISOString() },
      }, tx);
    });
  }

  async consume(input: { stateHash: string; userId: string; sessionId: string; now: Date }): Promise<GhlOAuthStateRecord | null> {
    return this.client.$transaction(async (tx) => {
      const record = await tx.ghlOAuthState.findUnique({ where: { stateHash: input.stateHash } });
      if (!record || record.userId !== input.userId || record.sessionId !== input.sessionId || record.expiresAt <= input.now) return null;
      const consumed = await tx.ghlOAuthState.deleteMany({
        where: {
          stateHash: input.stateHash,
          userId: input.userId,
          sessionId: input.sessionId,
          expiresAt: { gt: input.now },
        },
      });
      if (consumed.count !== 1) return null;
      return record;
    });
  }
}

export function hashGhlOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function createGhlAuthorizationUrl(installUrl: string, state: string): string {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(state)) throw new Error("GHL OAuth state is invalid");
  let url: URL;
  try {
    url = new URL(installUrl);
  } catch {
    throw new Error("GHL Marketplace installation URL is invalid");
  }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    || url.username || url.password || url.hash) {
    throw new Error("GHL Marketplace installation URL must be a safe HTTPS URL");
  }
  url.searchParams.set("state", state);
  return url.toString();
}

export async function beginGhlOAuth(
  store: GhlOAuthStateStore,
  actor: GhlOAuthActor,
  input: { installUrl: string; redirectUri: string; now?: number },
): Promise<{ authorizationUrl: string; expiresAt: string }> {
  const now = input.now ?? Date.now();
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now + GHL_OAUTH_STATE_TTL_MS);
  const record: GhlOAuthStateRecord = {
    stateHash: hashGhlOAuthState(state),
    userId: actor.id,
    sessionId: actor.sessionId,
    redirectUri: input.redirectUri,
    expiresAt,
  };
  const authorizationUrl = createGhlAuthorizationUrl(input.installUrl, state);
  await store.issue(record);
  return { authorizationUrl, expiresAt: expiresAt.toISOString() };
}

export type GhlOAuthCallbackResult =
  | { status: "connected"; state: GhlOAuthStateRecord }
  | { status: "cancelled" }
  | { status: "invalid" };

export async function completeGhlOAuthCallback(
  store: GhlOAuthStateStore,
  actor: GhlOAuthActor,
  input: { state: string | null; code: string | null; providerError: string | null; now?: number },
  exchange: (code: string, redirectUri: string) => Promise<void>,
): Promise<GhlOAuthCallbackResult> {
  if (!input.state || input.state.length > 128 || !/^[A-Za-z0-9_-]{40,128}$/.test(input.state)) return { status: "invalid" };
  const state = await store.consume({
    stateHash: hashGhlOAuthState(input.state),
    userId: actor.id,
    sessionId: actor.sessionId,
    now: new Date(input.now ?? Date.now()),
  });
  if (!state) return { status: "invalid" };
  if (input.providerError) return { status: "cancelled" };
  const code = input.code?.trim();
  if (!code || code.length > 4096) return { status: "invalid" };
  await exchange(code, state.redirectUri);
  return { status: "connected", state };
}

export function isPrivilegedGhlAdmin(user: Pick<SessionUser, "roles">): boolean {
  return user.roles.includes("OWNER") || user.roles.includes("ADMIN");
}

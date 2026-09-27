import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { GhlStoredTokens, GhlTokenStore } from "@/server/crm/ghl-client";

const TOKEN_ENVELOPE_VERSION = "v1";
const REFRESH_TRANSACTION_TIMEOUT_MS = 30_000;

function encryptionKey(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("CRM_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key");
  }
  return Buffer.from(value, "hex");
}

function validateTokens(value: GhlStoredTokens, expectedLocationId: string): GhlStoredTokens {
  if (!value.accessToken.trim() || !value.refreshToken.trim() || !Number.isFinite(value.expiresAt)
    || value.expiresAt <= 0 || value.locationId !== expectedLocationId) {
    throw new Error("GHL OAuth credential does not match the configured location or token contract");
  }
  return value;
}

export function encryptGhlTokens(tokens: GhlStoredTokens, locationId: string, keyHex: string): string {
  validateTokens(tokens, locationId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyHex), iv);
  cipher.setAAD(Buffer.from(`iere:ghl-oauth:${TOKEN_ENVELOPE_VERSION}:${locationId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [TOKEN_ENVELOPE_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptGhlTokens(envelope: string, locationId: string, keyHex: string): GhlStoredTokens {
  const [version, iv, tag, ciphertext, extra] = envelope.split(":");
  if (version !== TOKEN_ENVELOPE_VERSION || !iv || !tag || !ciphertext || extra !== undefined) {
    throw new Error("Stored GHL OAuth credential envelope is invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyHex), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`iere:ghl-oauth:${TOKEN_ENVELOPE_VERSION}:${locationId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const cleartext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    const value = JSON.parse(cleartext) as GhlStoredTokens;
    return validateTokens(value, locationId);
  } catch {
    throw new Error("Stored GHL OAuth credentials could not be decrypted");
  }
}

/**
 * Stores only authenticated ciphertext. A transaction-scoped advisory lock
 * serializes refreshes across web and worker processes so rotated refresh
 * tokens cannot overwrite one another.
 */
export class PrismaGhlTokenStore implements GhlTokenStore {
  private readonly locationId: string;

  constructor(locationId: string, private readonly keyHex: string, private readonly client: PrismaClient = db) {
    this.locationId = locationId.trim();
    if (!this.locationId) throw new Error("GHL location ID is required for token storage");
    encryptionKey(keyHex);
  }

  async read(): Promise<GhlStoredTokens | null> {
    const record = await this.client.ghlOAuthCredential.findUnique({ where: { locationId: this.locationId } });
    return record ? decryptGhlTokens(record.encryptedTokens, this.locationId, this.keyHex) : null;
  }

  async install(tokens: GhlStoredTokens): Promise<void> {
    await this.write(this.client, tokens);
  }

  async withRefreshLock<T>(
    work: (current: GhlStoredTokens | null, save: (tokens: GhlStoredTokens) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`iere:ghl-oauth:${this.locationId}`}, 0))::text AS lock_acquired`;
      const record = await tx.ghlOAuthCredential.findUnique({ where: { locationId: this.locationId } });
      const current = record ? decryptGhlTokens(record.encryptedTokens, this.locationId, this.keyHex) : null;
      const save = async (tokens: GhlStoredTokens) => { await this.write(tx, tokens); };
      return work(current, save);
    }, { maxWait: 10_000, timeout: REFRESH_TRANSACTION_TIMEOUT_MS });
  }

  private async write(client: { ghlOAuthCredential: PrismaClient["ghlOAuthCredential"] }, tokens: GhlStoredTokens) {
    const encryptedTokens = encryptGhlTokens(tokens, this.locationId, this.keyHex);
    await client.ghlOAuthCredential.upsert({
      where: { locationId: this.locationId },
      create: { locationId: this.locationId, encryptedTokens },
      update: { encryptedTokens },
    });
  }
}

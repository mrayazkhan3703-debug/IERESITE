import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import { getConfig } from "@/lib/config";

export const PRIVILEGED_ROLES = ["OWNER", "ADMIN", "MANAGER", "CONTENT_EDITOR"] as const;

export function requiresPrivilegedMfa(roles: readonly string[]): boolean {
  return roles.some((role) => (PRIVILEGED_ROLES as readonly string[]).includes(role));
}

function encryptionKey(): Buffer {
  const configured = getConfig().AUTH_MFA_ENCRYPTION_KEY;
  if (!configured || !/^[a-f0-9]{64}$/i.test(configured)) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEY must be a 64-character hexadecimal key");
  }
  return Buffer.from(configured, "hex");
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptMfaSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid MFA secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateMfaSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, at = Date.now()): string {
  const counter = BigInt(Math.floor(at / 30_000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => totpCode(secret, at + window * 30_000) === code);
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function recoveryHash(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function generateRecoveryCodes(count = 10): { raw: string[]; hashes: string[] } {
  const raw = Array.from({ length: count }, () => {
    const value = base32Encode(randomBytes(8)).slice(0, 12);
    return value.match(/.{1,4}/g)!.join("-");
  });
  return { raw, hashes: raw.map(recoveryHash) };
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyMfaOrRecoveryCode(input: {
  tx: Prisma.TransactionClient;
  userId: string;
  secretCiphertext: string;
  recoveryCodesJson: string | null;
  code: string;
}): Promise<boolean> {
  if (verifyTotp(decryptMfaSecret(input.secretCiphertext), input.code.trim())) return true;
  const hashes = JSON.parse(input.recoveryCodesJson ?? "[]") as string[];
  const candidate = recoveryHash(input.code);
  const index = hashes.findIndex((hash) => safeHashEqual(hash, candidate));
  if (index < 0) return false;
  hashes.splice(index, 1);
  await input.tx.user.update({
    where: { id: input.userId },
    data: { mfaRecoveryCodesJson: JSON.stringify(hashes) },
  });
  return true;
}

export function mfaProvisioningUri(email: string, secret: string): string {
  const issuer = "Investment Experts";
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

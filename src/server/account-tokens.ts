import { createHash, randomBytes } from "crypto";
import type { AccountToken, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AccountTokenPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD" | "CHANGE_EMAIL" | "MFA_SETUP" | "MFA_LOGIN";

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueAccountToken(input: {
  userId: string;
  purpose: AccountTokenPurpose;
  pendingValue?: string | null;
  ttlMinutes: number;
}): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashAccountToken(raw);
  await db.$transaction(async (tx) => {
    await tx.accountToken.deleteMany({
      where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    });
    await tx.accountToken.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        tokenHash,
        pendingValue: input.pendingValue ?? null,
        expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
      },
    });
  });
  return raw;
}

export async function consumeAccountToken<T>(
  raw: string,
  purpose: AccountTokenPurpose,
  apply: (tx: Prisma.TransactionClient, token: AccountToken) => Promise<T>,
): Promise<T | null> {
  return db.$transaction(async (tx) => {
    const token = await tx.accountToken.findUnique({
      where: { tokenHash: hashAccountToken(raw) },
    });
    if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= new Date()) return null;

    const claimed = await tx.accountToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    return apply(tx, token);
  });
}

export async function getValidAccountToken(raw: string, purpose: AccountTokenPurpose): Promise<AccountToken | null> {
  const token = await db.accountToken.findUnique({ where: { tokenHash: hashAccountToken(raw) } });
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= new Date()) return null;
  return token;
}

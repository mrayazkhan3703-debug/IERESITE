import { Prisma, PrismaClient } from '@prisma/client'

// BigInt minor units serialize as decimal strings in all JSON responses (ADR-009)
declare global {
  interface BigInt {
    toJSON(): string
  }
}
if (typeof BigInt !== 'undefined' && !BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function (this: bigint) {
    return this.toString()
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prismaDatabaseUrl = (() => {
  const value = process.env.DATABASE_URL
  if (!value) return undefined

  try {
    const url = new URL(value)
    // Keep this Render service below Supabase's 15-connection session-pool limit.
    if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432') {
      url.searchParams.set('connection_limit', '3')
    }
    return url.toString()
  } catch {
    return value
  }
})()

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(prismaDatabaseUrl ? { datasources: { db: { url: prismaDatabaseUrl } } } : {}),
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/** Read either native JSONB values or legacy JSON text during staged migration. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** Normalize arbitrary domain payloads into values accepted by Prisma JSONB inputs. */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as Prisma.InputJsonValue
}

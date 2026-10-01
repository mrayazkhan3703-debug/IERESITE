/**
 * Authentication service (ADR-005): scrypt password hashing + DB sessions + RBAC.
 * All admin authorization enforced server-side; UI hiding is never the only control.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";
import { db } from "@/lib/db";
import { getConfig, requiresSecureCookies } from "@/lib/config";
import type { Prisma } from "@prisma/client";
import { hasGrantedPermission } from "@/server/authz-policy";
import { pseudonymizeIp } from "@/server/security/ip-address";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requiresPrivilegedMfa } from "@/server/mfa";
import { serializeAuditData } from "@/server/audit-data";

export { hasPermission, permissionsForRoles } from "@/server/authz-policy";

const SESSION_TTL_MS = () => getConfig().AUTH_SESSION_TTL_HOURS * 3600_000;

/* Passwords ------------------------------------------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* Sessions -------------------------------------------------------------- */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return pseudonymizeIp(ip, getConfig().IP_PSEUDONYM_KEY);
}

export interface SessionUser {
  sessionId: string;
  id: string;
  email: string;
  name: string | null;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
  mfaVerified: boolean;
}

export async function createSession(userId: string, meta?: { userAgent?: string | null; ip?: string | null; mfaVerified?: boolean }) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: meta?.userAgent?.slice(0, 200) ?? null,
      ipHash: hashIp(meta?.ip),
      mfaVerifiedAt: meta?.mfaVerified ? new Date() : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS()),
    },
  });
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  rolePermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session) return null;
  if (!session.user.isActive) {
    await db.session.deleteMany({ where: { userId: session.userId } }).catch(() => {});
    return null;
  }
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Sliding rotation
  if (Date.now() - session.rotatedAt.getTime() > 3600_000) {
    await db.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS()), rotatedAt: new Date() },
    }).catch(() => {});
  }
  return {
    sessionId: session.id,
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    organizationId: session.user.organizationId,
    roles: session.user.roles.map((r) => r.role.key),
    permissions: [...new Set(session.user.roles.flatMap((r) =>
      r.role.rolePermissions.map((grant) => grant.permission.key),
    ))],
    mfaVerified: session.mfaVerifiedAt !== null,
  };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

export async function setSessionCookie(token: string): Promise<void> {
  const config = getConfig();
  const jar = await cookies();
  jar.set(config.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requiresSecureCookies(config),
    path: "/",
    maxAge: config.AUTH_SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(getConfig().AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: requiresSecureCookies(getConfig()),
    path: "/",
    maxAge: 0,
  });
}

/* RBAC (PART N permission matrix) ---------------------------------------- */

/* Route guards ------------------------------------------------------------ */

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return getSessionUser(jar.get(getConfig().AUTH_COOKIE_NAME)?.value);
}

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Authentication required", "AUTH_REQUIRED");
  if (requiresPrivilegedMfa(user.roles) && !user.mfaVerified) {
    throw new HttpError(403, "Multi-factor authentication is required", "MFA_REQUIRED");
  }
  return user;
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasGrantedPermission(user.permissions, permission)) {
    throw new HttpError(403, "You do not have permission to perform this action", "FORBIDDEN");
  }
  return user;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json({ error: "Internal server error", code: "INTERNAL" }, { status: 500 });
}

/* Audit ------------------------------------------------------------------- */

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

export async function audit(opts: {
  actorType?: string;
  actorId?: string | null;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}, client: AuditClient = db) {
  await client.auditLog.create({
    data: {
      actorType: opts.actorType ?? "USER",
      actorId: opts.actorId ?? null,
      organizationId: opts.organizationId ?? null,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      beforeJson: serializeAuditData(opts.before),
      afterJson: serializeAuditData(opts.after),
      ipHash: hashIp(opts.ip),
    },
  });
}

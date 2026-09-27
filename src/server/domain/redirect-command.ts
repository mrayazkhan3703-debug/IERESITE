import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { isSafeInternalRedirectPath } from "@/server/seo/redirect-path";

export interface RedirectInput {
  fromPath: string;
  toPath: string;
  statusCode: number;
  note?: string | null;
  isActive?: boolean;
}

function requireEditor(actor: SessionUser) {
  if (!actor.roles.some((role) => ["OWNER", "ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new HttpError(403, "You cannot manage redirects.", "REDIRECT_EDIT_FORBIDDEN");
  }
}

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid redirect version.", "INVALID_VERSION");
  return parsed;
}

function validatePath(value: string, label: string) {
  const path = value.trim();
  if (!isSafeInternalRedirectPath(path)) {
    throw new HttpError(422, `${label} must be a normalized, same-site public path (no host, query, fragment, encoded or reserved route).`, "REDIRECT_PATH_INVALID");
  }
  return path;
}

function validate(input: RedirectInput) {
  const fromPath = validatePath(input.fromPath, "Source path");
  const toPath = validatePath(input.toPath, "Destination path");
  if (fromPath === "/" || fromPath === toPath) throw new HttpError(422, "A redirect cannot replace the home path or point to itself.", "REDIRECT_PATH_INVALID");
  if (![301, 302, 303, 307, 308].includes(input.statusCode)) throw new HttpError(422, "Choose a supported redirect status code.", "REDIRECT_STATUS_INVALID");
  const note = input.note?.trim().slice(0, 500) || null;
  return { fromPath, toPath, statusCode: input.statusCode, note };
}

function snapshot(record: { fromPath: string; toPath: string; statusCode: number; isActive: boolean; note: string | null }) {
  return { fromPath: record.fromPath, toPath: record.toPath, statusCode: record.statusCode, isActive: record.isActive, note: record.note };
}

async function assertNoRedirectChain(tx: Prisma.TransactionClient, id: string | null, fromPath: string, toPath: string) {
  const excluded = id ? { id: { not: id } } : {};
  const destinationRedirect = await tx.redirect.findFirst({ where: { ...excluded, fromPath: toPath, isActive: true }, select: { id: true } });
  const incomingRedirect = await tx.redirect.findFirst({ where: { ...excluded, toPath: fromPath, isActive: true }, select: { id: true } });
  if (destinationRedirect || incomingRedirect) {
    throw new HttpError(409, "This change would create a redirect chain. Keep active redirects as one hop.", "REDIRECT_CHAIN_BLOCKED");
  }
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "The redirect changed during save. Refresh and retry.", "VERSION_CONFLICT");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "Another redirect already uses this source path.", "REDIRECT_SOURCE_CONFLICT");
  }
  throw error;
}

export async function createRedirectCommand(actor: SessionUser, input: RedirectInput, ip: string | null) {
  requireEditor(actor);
  const values = validate(input);
  try {
    return await db.$transaction(async (tx) => {
      const redirect = await tx.redirect.create({ data: { ...values, isActive: false } });
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: "redirect.create_disabled", resourceType: "redirect", resourceId: redirect.id,
        after: snapshot(redirect), ip,
      }, tx);
      return { id: redirect.id, isActive: false, updatedAt: redirect.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

export async function updateRedirectCommand(
  actor: SessionUser,
  input: RedirectInput & { redirectId: string; expectedUpdatedAt: string; isActive: boolean },
  ip: string | null,
) {
  requireEditor(actor);
  const values = validate(input);
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.redirect.findUnique({ where: { id: input.redirectId } });
      if (!current) throw new HttpError(404, "Redirect not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This redirect changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      if (input.isActive) await assertNoRedirectChain(tx, current.id, values.fromPath, values.toPath);
      const before = snapshot(current);
      const changed = await tx.redirect.updateMany({
        where: { id: current.id, updatedAt: expectedUpdatedAt },
        data: { ...values, isActive: input.isActive, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "This redirect changed during save. Refresh and retry.", "VERSION_CONFLICT");
      const updated = await tx.redirect.findUniqueOrThrow({ where: { id: current.id } });
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: "redirect.update", resourceType: "redirect", resourceId: current.id,
        before, after: snapshot(updated), ip,
      }, tx);
      return { ok: true as const, isActive: updated.isActive, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

export async function setRedirectActiveCommand(actor: SessionUser, redirectId: string, expectedUpdatedAtText: string, isActive: boolean, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.redirect.findUnique({ where: { id: redirectId } });
      if (!current) throw new HttpError(404, "Redirect not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This redirect changed since it was loaded. Refresh before changing its state.", "VERSION_CONFLICT");
      if (current.isActive === isActive) throw new HttpError(409, isActive ? "This redirect is already active." : "This redirect is already disabled.", "REDIRECT_STATE_CONFLICT");
      if (isActive) {
        const values = validate(current);
        await assertNoRedirectChain(tx, current.id, values.fromPath, values.toPath);
      }
      const before = snapshot(current);
      const changed = await tx.redirect.updateMany({ where: { id: current.id, updatedAt: expectedUpdatedAt }, data: { isActive, updatedAt: new Date() } });
      if (changed.count !== 1) throw new HttpError(409, "This redirect changed during the state change. Refresh and retry.", "VERSION_CONFLICT");
      const updated = await tx.redirect.findUniqueOrThrow({ where: { id: current.id } });
      await audit({
        actorId: actor.id, organizationId: actor.organizationId, action: isActive ? "redirect.activate" : "redirect.disable", resourceType: "redirect", resourceId: current.id,
        before, after: snapshot(updated), ip,
      }, tx);
      return { ok: true as const, isActive, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { resolveSpaRoute } from "@/server/seo/route-contract";

const CHANGE_FREQUENCIES = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"] as const;

export interface SeoMetadataInput {
  routeKey: string;
  title?: string | null;
  description?: string | null;
  canonicalPath?: string | null;
  noindex: boolean;
  ogImageMediaId?: string | null;
  priority?: number | null;
  changefreq?: string | null;
}

interface SeoValues {
  routeKey: string;
  title: string | null;
  description: string | null;
  canonicalPath: string | null;
  noindex: boolean;
  ogImageMediaId: string | null;
  priority: number | null;
  changefreq: string | null;
}

function requireEditor(actor: SessionUser) {
  if (!actor.roles.some((role) => ["OWNER", "ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new HttpError(403, "You cannot manage SEO metadata.", "SEO_METADATA_EDIT_FORBIDDEN");
  }
}

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid SEO metadata version.", "INVALID_VERSION");
  return parsed;
}

function validate(input: SeoMetadataInput): SeoValues {
  const routeKey = input.routeKey.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (routeKey !== "home" && !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(routeKey)) {
    throw new HttpError(422, "Route key must be a normalized public route path without leading or trailing slash.", "SEO_ROUTE_KEY_INVALID");
  }
  const routePath = routeKey === "home" ? "/" : `/${routeKey}`;
  const route = resolveSpaRoute(routePath);
  if (!route || route.noindex) throw new HttpError(422, "SEO metadata can only be assigned to a known public route.", "SEO_ROUTE_KEY_INVALID");
  const title = input.title?.trim() || null;
  const description = input.description?.trim() || null;
  if (title && title.length > 300) throw new HttpError(422, "SEO title is too long.", "SEO_METADATA_VALIDATION");
  if (description && description.length > 1000) throw new HttpError(422, "SEO description is too long.", "SEO_METADATA_VALIDATION");
  const canonicalPath = input.canonicalPath?.trim() || null;
  if (canonicalPath) {
    const segments = canonicalPath.split("/").filter(Boolean);
    if (
      canonicalPath.length > 500 || !canonicalPath.startsWith("/") || canonicalPath.startsWith("//") ||
      !/^\/[A-Za-z0-9._~/-]*$/.test(canonicalPath) || canonicalPath.includes("//") ||
      (canonicalPath.endsWith("/") && canonicalPath !== "/") || segments.some((segment) => segment === "." || segment === "..") ||
      ["api", "_next", "admin", "account"].includes((segments[segments[0] === "ar" ? 1 : 0] ?? "").toLowerCase()) ||
      !resolveSpaRoute(canonicalPath === "/ar" ? "/" : canonicalPath.replace(/^\/ar\//, "/")) ||
      resolveSpaRoute(canonicalPath === "/ar" ? "/" : canonicalPath.replace(/^\/ar\//, "/"))?.noindex
    ) throw new HttpError(422, "Canonical path must be a normalized same-site public path.", "SEO_CANONICAL_PATH_INVALID");
  }
  if (input.priority !== undefined && input.priority !== null && (!Number.isFinite(input.priority) || input.priority < 0 || input.priority > 1)) {
    throw new HttpError(422, "Sitemap priority must be between 0 and 1.", "SEO_PRIORITY_INVALID");
  }
  if (input.changefreq && !CHANGE_FREQUENCIES.includes(input.changefreq as typeof CHANGE_FREQUENCIES[number])) {
    throw new HttpError(422, "Choose a supported sitemap change frequency.", "SEO_CHANGEFREQ_INVALID");
  }
  if (!title && !description && !canonicalPath && !input.noindex && !input.ogImageMediaId && input.priority == null && !input.changefreq) {
    throw new HttpError(422, "Enter at least one SEO override before saving.", "SEO_METADATA_EMPTY");
  }
  return {
    routeKey,
    title,
    description,
    canonicalPath,
    noindex: input.noindex,
    ogImageMediaId: input.ogImageMediaId?.trim() || null,
    priority: input.priority ?? null,
    changefreq: input.changefreq || null,
  };
}

async function ensurePublicImage(tx: Prisma.TransactionClient, id: string | null) {
  if (!id) return null;
  const media = await tx.mediaAsset.findFirst({ where: { id, isPrivate: false, mimeType: { startsWith: "image/" } }, select: { id: true } });
  if (!media) throw new HttpError(422, "Choose an existing public image from the Media Library.", "MEDIA_NOT_AVAILABLE");
  return media.id;
}

function snapshot(values: SeoValues) { return JSON.stringify(values); }

async function recordChange(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  id: string,
  values: SeoValues,
  ip: string | null,
  action: string,
  note: string,
  before?: Record<string, unknown>,
) {
  const latest = await tx.seoMetadataRevision.aggregate({ where: { seoMetadataId: id }, _max: { version: true } });
  await tx.seoMetadataRevision.create({ data: {
    seoMetadataId: id,
    version: (latest._max.version ?? 0) + 1,
    snapshotJson: snapshot(values),
    editedBy: actor.id,
    changeNote: note.slice(0, 300),
  } });
  await audit({
    actorId: actor.id, organizationId: actor.organizationId, action, resourceType: "seo_metadata", resourceId: id,
    before, after: values, ip,
  }, tx);
}

function state(record: SeoValues & { updatedAt?: Date }) {
  return {
    routeKey: record.routeKey, title: record.title, description: record.description, canonicalPath: record.canonicalPath,
    noindex: record.noindex, ogImageMediaId: record.ogImageMediaId, priority: record.priority, changefreq: record.changefreq,
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new HttpError(409, "SEO metadata changed during save. Refresh and retry.", "VERSION_CONFLICT");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "SEO metadata already exists for this route.", "SEO_ROUTE_CONFLICT");
  }
  throw error;
}

export async function createSeoMetadataCommand(actor: SessionUser, input: SeoMetadataInput, ip: string | null) {
  requireEditor(actor);
  const values = validate(input);
  try {
    return await db.$transaction(async (tx) => {
      const ogImageMediaId = await ensurePublicImage(tx, values.ogImageMediaId);
      const entry = await tx.seoMetadata.create({ data: { ...values, ogImageMediaId } });
      const next = { ...values, ogImageMediaId };
      await recordChange(tx, actor, entry.id, next, ip, "seo_metadata.create", "Created route SEO metadata");
      return { id: entry.id, routeKey: entry.routeKey, updatedAt: entry.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

export async function updateSeoMetadataCommand(
  actor: SessionUser,
  input: SeoMetadataInput & { seoMetadataId: string; expectedUpdatedAt: string; changeNote?: string | null },
  ip: string | null,
) {
  requireEditor(actor);
  const values = validate(input);
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.seoMetadata.findUnique({ where: { id: input.seoMetadataId } });
      if (!current) throw new HttpError(404, "SEO metadata not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This SEO metadata changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");
      const ogImageMediaId = await ensurePublicImage(tx, values.ogImageMediaId);
      const changed = await tx.seoMetadata.updateMany({
        where: { id: current.id, updatedAt: expectedUpdatedAt },
        data: { ...values, ogImageMediaId, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new HttpError(409, "This SEO metadata changed during save. Refresh and retry.", "VERSION_CONFLICT");
      const updated = await tx.seoMetadata.findUniqueOrThrow({ where: { id: current.id } });
      const next = { ...values, ogImageMediaId };
      await recordChange(tx, actor, current.id, next, ip, "seo_metadata.update", input.changeNote?.trim() || "Updated route SEO metadata", state(current));
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

export async function rollbackSeoMetadataCommand(actor: SessionUser, seoMetadataId: string, revisionId: string, expectedUpdatedAtText: string, ip: string | null) {
  requireEditor(actor);
  const expectedUpdatedAt = parseVersion(expectedUpdatedAtText);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.seoMetadata.findUnique({ where: { id: seoMetadataId } });
      if (!current) throw new HttpError(404, "SEO metadata not found.", "NOT_FOUND");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This SEO metadata changed since it was loaded. Refresh before restoring.", "VERSION_CONFLICT");
      const revision = await tx.seoMetadataRevision.findFirst({ where: { id: revisionId, seoMetadataId } });
      if (!revision) throw new HttpError(404, "SEO metadata revision not found.", "REVISION_NOT_FOUND");
      let values: SeoValues;
      try { values = validate(JSON.parse(revision.snapshotJson) as SeoMetadataInput); }
      catch { throw new HttpError(422, "This historical SEO revision cannot be restored.", "REVISION_INVALID"); }
      const ogImageMediaId = await ensurePublicImage(tx, values.ogImageMediaId);
      const changed = await tx.seoMetadata.updateMany({ where: { id: current.id, updatedAt: expectedUpdatedAt }, data: { ...values, ogImageMediaId, updatedAt: new Date() } });
      if (changed.count !== 1) throw new HttpError(409, "This SEO metadata changed during restore. Refresh and retry.", "VERSION_CONFLICT");
      const updated = await tx.seoMetadata.findUniqueOrThrow({ where: { id: current.id } });
      const next = { ...values, ogImageMediaId };
      await recordChange(tx, actor, current.id, next, ip, "seo_metadata.restore_revision", `Restored revision ${revision.version}`, state(current));
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return translateWriteError(error); }
}

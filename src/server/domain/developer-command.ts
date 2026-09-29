import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { requirePublicMedia } from "@/server/domain/media-policy";
import { canCreateCatalogResource, canManageCatalogResource } from "@/server/domain/resource-policy";

export interface DeveloperCommandInput {
  developerId: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  summary?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  headquarters?: string | null;
  foundedYear?: number | null;
  logoMediaId?: string | null;
  verificationStatus?: "UNVERIFIED" | "PUBLIC_RECORDS" | "VERIFIED";
  verificationEvidenceUrl?: string | null;
  sourceType?: string;
  sourceUpdatedAt?: string | null;
}

export interface NewDeveloperCommandInput {
  name: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  headquarters?: string | null;
  foundedYear?: number | null;
  logoMediaId?: string | null;
  sourceType?: string;
  sourceUpdatedAt?: string | null;
}

function normalizeDeveloper(input: { name: string; slug: string; websiteUrl?: string | null }) {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpError(422, "Developer name and a URL-safe slug are required.", "DEVELOPER_VALIDATION");
  }
  if (input.websiteUrl?.trim()) {
    let url: URL;
    try { url = new URL(input.websiteUrl.trim()); } catch { throw new HttpError(422, "Website must be a valid HTTP or HTTPS URL.", "DEVELOPER_VALIDATION"); }
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new HttpError(422, "Website must use HTTP or HTTPS.", "DEVELOPER_VALIDATION");
  }
  return { name, slug, websiteUrl: input.websiteUrl?.trim() || null };
}

export async function createDeveloperCommand(actor: SessionUser, input: NewDeveloperCommandInput, ip: string | null) {
  if (!canCreateCatalogResource(actor)) throw new HttpError(403, "Catalog creation requires an organization-scoped staff role.", "RESOURCE_FORBIDDEN");
  const normalized = normalizeDeveloper(input);
  try {
    return await db.$transaction(async (tx) => {
      const logoMediaId = await requirePublicMedia(tx, input.logoMediaId, ["IMAGE"]);
      const developer = await tx.developer.create({
        data: {
          ownerOrganizationId: actor.organizationId,
          name: normalized.name,
          slug: normalized.slug,
          summary: input.summary?.trim() || null,
          description: input.description?.trim() || null,
          websiteUrl: normalized.websiteUrl,
          headquarters: input.headquarters?.trim() || null,
          foundedYear: input.foundedYear ?? null,
          logoMediaId,
          verificationStatus: "UNVERIFIED",
          lastVerifiedAt: null,
          sourceType: input.sourceType?.trim() || "INTERNAL",
          sourceUpdatedAt: input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null,
          retrievedAt: input.sourceUpdatedAt ? new Date() : null,
          isDemoData: false,
        },
      });
      const after = {
        name: developer.name, slug: developer.slug, summary: developer.summary, description: developer.description,
        websiteUrl: developer.websiteUrl, headquarters: developer.headquarters, foundedYear: developer.foundedYear,
        verificationStatus: developer.verificationStatus, lastVerifiedAt: null, logoMediaId: developer.logoMediaId,
        sourceType: developer.sourceType, sourceUpdatedAt: developer.sourceUpdatedAt,
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "developer.create", resourceType: "developer", resourceId: developer.id, before: null, after, ip }, tx);
      await emitEvent("developer", developer.id, "developer.updated", { developerId: developer.id, by: actor.email }, tx);
      return { id: developer.id, updatedAt: developer.updatedAt.toISOString(), verificationStatus: developer.verificationStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That developer slug is already in use.", "SLUG_CONFLICT");
    }
    throw error;
  }
}

export async function updateDeveloperCommand(actor: SessionUser, input: DeveloperCommandInput, ip: string | null) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid developer version", "INVALID_VERSION");

  try {
    return await db.$transaction(async (tx) => {
      const developer = await tx.developer.findUnique({ where: { id: input.developerId } });
      if (!developer) throw new HttpError(404, "Developer not found", "NOT_FOUND");
      if (!canManageCatalogResource(actor, developer.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this developer record.", "RESOURCE_FORBIDDEN");
      if (developer.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This developer changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const normalized = normalizeDeveloper({ name: input.name ?? developer.name, slug: input.slug ?? developer.slug, websiteUrl: input.websiteUrl === undefined ? developer.websiteUrl : input.websiteUrl });
      const { name, slug } = normalized;
      const logoMediaId = input.logoMediaId === undefined
        ? developer.logoMediaId
        : await requirePublicMedia(tx, input.logoMediaId, ["IMAGE"]);

      const verificationChanged = input.verificationStatus !== undefined || input.verificationEvidenceUrl !== undefined;
      if (verificationChanged && !actor.roles.some((role) => role === "OWNER" || role === "ADMIN")) {
        throw new HttpError(403, "Only an owner or administrator can change developer verification status.", "VERIFICATION_FORBIDDEN");
      }
      const verificationStatus = input.verificationStatus ?? developer.verificationStatus;
      const verificationEvidenceUrl = input.verificationEvidenceUrl === undefined ? developer.verificationEvidenceUrl : input.verificationEvidenceUrl?.trim() || null;
      if (verificationStatus !== "UNVERIFIED") {
        if (!verificationEvidenceUrl) throw new HttpError(422, "Attach an HTTP or HTTPS verification source before marking this developer verified.", "DEVELOPER_EVIDENCE_REQUIRED");
        let source: URL;
        try { source = new URL(verificationEvidenceUrl); } catch { throw new HttpError(422, "Verification evidence must be a valid HTTP or HTTPS URL.", "DEVELOPER_EVIDENCE_INVALID"); }
        if (!new Set(["http:", "https:"]).has(source.protocol)) throw new HttpError(422, "Verification evidence must use HTTP or HTTPS.", "DEVELOPER_EVIDENCE_INVALID");
      }
      const lastVerifiedAt = verificationStatus === "UNVERIFIED" ? null : verificationChanged ? new Date() : developer.lastVerifiedAt;

      const before = {
        name: developer.name, slug: developer.slug, summary: developer.summary, description: developer.description,
        websiteUrl: developer.websiteUrl, headquarters: developer.headquarters, foundedYear: developer.foundedYear, logoMediaId: developer.logoMediaId,
        verificationStatus: developer.verificationStatus, verificationEvidenceUrl: developer.verificationEvidenceUrl,
        lastVerifiedAt: developer.lastVerifiedAt, sourceType: developer.sourceType, sourceUpdatedAt: developer.sourceUpdatedAt,
      };
      const data: Prisma.DeveloperUpdateManyMutationInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = name;
      if (input.slug !== undefined) data.slug = slug;
      if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl?.trim() || null;
      if (input.headquarters !== undefined) data.headquarters = input.headquarters?.trim() || null;
      if (input.foundedYear !== undefined) data.foundedYear = input.foundedYear;
      if (input.logoMediaId !== undefined) data.logoMediaId = logoMediaId;
      if (input.verificationStatus !== undefined) data.verificationStatus = verificationStatus;
      if (verificationChanged) { data.verificationEvidenceUrl = verificationStatus === "UNVERIFIED" ? null : verificationEvidenceUrl; data.lastVerifiedAt = lastVerifiedAt; }
      if (input.sourceType !== undefined) data.sourceType = input.sourceType.trim();
      if (input.sourceUpdatedAt !== undefined) { data.sourceUpdatedAt = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null; data.retrievedAt = input.sourceUpdatedAt ? new Date() : null; }

      const changed = await tx.developer.updateMany({ where: { id: developer.id, updatedAt: expectedUpdatedAt }, data });
      if (changed.count !== 1) throw new HttpError(409, "This developer changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");

      if (slug !== developer.slug) {
        const fromPath = `/developers/${developer.slug}`;
        const toPath = `/developers/${slug}`;
        await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
        const redirect = await tx.redirect.findUnique({ where: { fromPath } });
        if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Developer slug changed in Admin" } });
        else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Developer slug changed in Admin" } });
      }

      const after = {
        name, slug,
        summary: input.summary === undefined ? developer.summary : input.summary?.trim() || null,
        description: input.description === undefined ? developer.description : input.description?.trim() || null,
        websiteUrl: input.websiteUrl === undefined ? developer.websiteUrl : input.websiteUrl?.trim() || null,
        headquarters: input.headquarters === undefined ? developer.headquarters : input.headquarters?.trim() || null,
        foundedYear: input.foundedYear === undefined ? developer.foundedYear : input.foundedYear,
        logoMediaId,
        verificationStatus, verificationEvidenceUrl: verificationStatus === "UNVERIFIED" ? null : verificationEvidenceUrl,
        lastVerifiedAt, sourceType: input.sourceType ?? developer.sourceType,
        sourceUpdatedAt: input.sourceUpdatedAt === undefined ? developer.sourceUpdatedAt : input.sourceUpdatedAt,
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "developer.update", resourceType: "developer", resourceId: developer.id, before, after, ip }, tx);
      await emitEvent("developer", developer.id, "developer.updated", { developerId: developer.id, by: actor.email }, tx);
      const updated = await tx.developer.findUniqueOrThrow({ where: { id: developer.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That developer slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This developer changed during the save. Refresh and review the latest values.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { requirePublicMedia } from "@/server/domain/media-policy";
import { canCreateCatalogResource, canManageCatalogResource } from "@/server/domain/resource-policy";

export interface ProjectCommandInput {
  projectId: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  tagline?: string | null;
  summary?: string | null;
  description?: string | null;
  projectType?: string;
  status?: string;
  publicationStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  brochureMediaId?: string | null;
}

export interface NewProjectCommandInput {
  developerId: string;
  communityId: string;
  name: string;
  slug: string;
  tagline?: string | null;
  summary?: string | null;
  description?: string | null;
  projectType: string;
  status: string;
  lat: number;
  lng: number;
  locationPrecision: "EXACT" | "BUILDING" | "PROJECT" | "COMMUNITY_CENTROID" | "APPROXIMATE";
  brochureMediaId?: string | null;
}

export async function createProjectCommand(actor: SessionUser, input: NewProjectCommandInput, ip: string | null) {
  if (!canCreateCatalogResource(actor)) throw new HttpError(403, "Catalog creation requires an organization-scoped staff role.", "RESOURCE_FORBIDDEN");
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpError(422, "Project name and a URL-safe slug are required.", "PROJECT_VALIDATION");
  }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90 || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new HttpError(422, "Valid coordinates are required before creating a project.", "PROJECT_VALIDATION");
  }

  try {
    return await db.$transaction(async (tx) => {
      const [developer, community] = await Promise.all([
        tx.developer.findUnique({ where: { id: input.developerId }, select: { id: true } }),
        tx.community.findUnique({ where: { id: input.communityId }, select: { id: true } }),
      ]);
      if (!developer || !community) throw new HttpError(422, "Select an existing developer and community.", "PROJECT_RELATION_REQUIRED");
      const brochureMediaId = await requirePublicMedia(tx, input.brochureMediaId, ["IMAGE", "DOCUMENT"]);
      const project = await tx.project.create({
        data: {
          ownerOrganizationId: actor.organizationId,
          developerId: developer.id,
          communityId: community.id,
          name,
          slug,
          tagline: input.tagline?.trim() || null,
          summary: input.summary?.trim() || null,
          description: input.description?.trim() || null,
          projectType: input.projectType,
          status: input.status,
          lat: input.lat,
          lng: input.lng,
          locationPrecision: input.locationPrecision,
          locationSourceType: "MANUAL_ADMIN",
          sourceType: "INTERNAL",
          publicationStatus: "DRAFT",
          brochureMediaId,
          isDemoData: false,
        },
      });
      const after = {
        developerId: project.developerId, communityId: project.communityId, name: project.name, slug: project.slug,
        tagline: project.tagline, summary: project.summary, description: project.description,
        projectType: project.projectType, status: project.status, lat: project.lat, lng: project.lng,
        locationPrecision: project.locationPrecision, locationSourceType: project.locationSourceType,
        publicationStatus: project.publicationStatus, brochureMediaId: project.brochureMediaId,
      };
      await tx.projectStatusHistory.create({ data: { projectId: project.id, fromStatus: null, toStatus: project.status, changedBy: actor.id, reason: "Initial Admin draft creation" } });
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "project.create", resourceType: "project", resourceId: project.id, before: null, after, ip }, tx);
      await emitEvent("project", project.id, "project.updated", { projectId: project.id, by: actor.email }, tx);
      return { id: project.id, updatedAt: project.updatedAt.toISOString(), publicationStatus: project.publicationStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That project slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "The project changed during creation. Review and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

export async function updateProjectCommand(actor: SessionUser, input: ProjectCommandInput, ip: string | null) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid project version", "INVALID_VERSION");

  try {
    return await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        include: {
          community: { select: { publicationStatus: true } },
          developer: { select: { id: true } },
        },
      });
      if (!project || project.deletedAt) throw new HttpError(404, "Project not found", "NOT_FOUND");
      if (!canManageCatalogResource(actor, project.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this project record.", "RESOURCE_FORBIDDEN");
      if (project.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This project changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const nextName = input.name?.trim() ?? project.name;
      const nextSlug = input.slug?.trim().toLowerCase() ?? project.slug;
      if (!nextName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
        throw new HttpError(422, "Project name and a URL-safe slug are required.", "PROJECT_VALIDATION");
      }
      if (input.publicationStatus === "PUBLISHED") {
        if (!nextName.trim()) throw new HttpError(422, "A project name is required before publishing.", "PUBLICATION_VALIDATION");
        if (project.community.publicationStatus !== "PUBLISHED") {
          throw new HttpError(422, "The linked community must be published first.", "PUBLICATION_VALIDATION");
        }
        if (!Number.isFinite(project.lat) || project.lat < -90 || project.lat > 90 || !Number.isFinite(project.lng) || project.lng < -180 || project.lng > 180) {
          throw new HttpError(422, "Valid project coordinates are required before publishing.", "PUBLICATION_VALIDATION");
        }
      }
      if (input.publicationStatus === "ARCHIVED" && project.publicationStatus !== "ARCHIVED") {
        const [publishedProperties, activeUnits, portfolioHoldings] = await Promise.all([
          tx.property.count({ where: { projectId: project.id, publicationStatus: "PUBLISHED", deletedAt: null } }),
          tx.propertyUnit.count({ where: { projectId: project.id, availabilityStatus: { in: ["AVAILABLE", "RESERVED", "HELD"] } } }),
          tx.portfolioHolding.count({ where: { projectId: project.id } }),
        ]);
        if (publishedProperties > 0 || activeUnits > 0 || portfolioHoldings > 0) {
          throw new HttpError(409, "Move or archive published properties, close active units, and resolve linked portfolio references before archiving this project.", "ACTIVE_PROJECT_USAGES_EXIST");
        }
      }
      const brochureMediaId = input.brochureMediaId === undefined
        ? project.brochureMediaId
        : await requirePublicMedia(tx, input.brochureMediaId, ["IMAGE", "DOCUMENT"]);

      const before = {
        name: project.name,
        slug: project.slug,
        tagline: project.tagline,
        summary: project.summary,
        description: project.description,
        projectType: project.projectType,
        status: project.status,
        publicationStatus: project.publicationStatus,
        brochureMediaId: project.brochureMediaId,
      };
      const data: Prisma.ProjectUpdateManyMutationInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = nextName;
      if (input.slug !== undefined) data.slug = nextSlug;
      if (input.tagline !== undefined) data.tagline = input.tagline?.trim() || null;
      if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.projectType !== undefined) data.projectType = input.projectType;
      if (input.status !== undefined) data.status = input.status;
      if (input.publicationStatus !== undefined) data.publicationStatus = input.publicationStatus;
      if (input.brochureMediaId !== undefined) data.brochureMediaId = brochureMediaId;

      const changed = await tx.project.updateMany({
        where: { id: project.id, updatedAt: expectedUpdatedAt, deletedAt: null },
        data,
      });
      if (changed.count !== 1) throw new HttpError(409, "This project changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");

      if (input.status !== undefined && input.status !== project.status) {
        await tx.projectStatusHistory.create({
          data: { projectId: project.id, fromStatus: project.status, toStatus: input.status, changedBy: actor.id },
        });
      }
      if (nextSlug !== project.slug) {
        const fromPath = `/projects/${project.slug}`;
        const toPath = `/projects/${nextSlug}`;
        await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
        const redirect = await tx.redirect.findUnique({ where: { fromPath } });
        if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Project slug changed in Admin" } });
        else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Project slug changed in Admin" } });
      }

      const after = {
        name: input.name === undefined ? project.name : nextName,
        slug: input.slug === undefined ? project.slug : nextSlug,
        tagline: input.tagline === undefined ? project.tagline : input.tagline?.trim() || null,
        summary: input.summary === undefined ? project.summary : input.summary?.trim() || null,
        description: input.description === undefined ? project.description : input.description?.trim() || null,
        projectType: input.projectType ?? project.projectType,
        status: input.status ?? project.status,
        publicationStatus: input.publicationStatus ?? project.publicationStatus,
        brochureMediaId,
      };
      await audit({
        actorId: actor.id,
        organizationId: actor.organizationId,
        action: input.publicationStatus === "PUBLISHED" ? "project.publish" : "project.update",
        resourceType: "project",
        resourceId: project.id,
        before,
        after,
        ip,
      }, tx);
      await emitEvent("project", project.id, "project.updated", { projectId: project.id, by: actor.email }, tx);

      const updated = await tx.project.findUniqueOrThrow({ where: { id: project.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That project slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This project changed during the save. Refresh and review the latest values.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

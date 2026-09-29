import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { requirePublicMedia } from "@/server/domain/media-policy";
import { canCreateCatalogResource, canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";

export interface ProjectCommandInput {
  projectId: string;
  expectedUpdatedAt: string;
  developerId?: string;
  communityId?: string;
  name?: string;
  slug?: string;
  tagline?: string | null;
  summary?: string | null;
  description?: string | null;
  projectType?: string;
  status?: string;
  publicationStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  brochureMediaId?: string | null;
  launchDate?: string | null;
  handoverDate?: string | null;
  completionPercent?: number | null;
  constructionStatus?: string | null;
  constructionSourceUrl?: string | null;
  constructionSourceVerifiedAt?: string | null;
  totalUnits?: number | null;
  startingPriceMinor?: string | null;
  currency?: string;
  highlights?: string[];
  keyAmenities?: string[];
  lat?: number;
  lng?: number;
  locationPrecision?: "EXACT" | "BUILDING" | "PROJECT" | "COMMUNITY_CENTROID" | "APPROXIMATE";
  amenityIds?: string[];
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
  launchDate?: string | null;
  handoverDate?: string | null;
  completionPercent?: number | null;
  constructionStatus?: string | null;
  constructionSourceUrl?: string | null;
  constructionSourceVerifiedAt?: string | null;
  totalUnits?: number | null;
  startingPriceMinor?: string | null;
  currency?: string;
  highlights?: string[];
  keyAmenities?: string[];
  amenityIds?: string[];
}

function asDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(422, "Enter a valid calendar date.", "PROJECT_DATE_INVALID");
  return date;
}

function validateProjectEvidence(input: { launchDate?: string | null; handoverDate?: string | null; completionPercent?: number | null; constructionSourceUrl?: string | null; constructionSourceVerifiedAt?: string | null }) {
  asDateOnly(input.launchDate);
  asDateOnly(input.handoverDate);
  if (input.launchDate && input.handoverDate && input.handoverDate < input.launchDate) {
    throw new HttpError(422, "Handover date cannot be earlier than launch date.", "PROJECT_DATE_RANGE");
  }
  if (input.completionPercent != null && (!Number.isFinite(input.completionPercent) || input.completionPercent < 0 || input.completionPercent > 100)) {
    throw new HttpError(422, "Construction completion must be between 0 and 100 percent.", "PROJECT_COMPLETION_PERCENT");
  }
  if (input.constructionSourceVerifiedAt && !input.constructionSourceUrl) {
    throw new HttpError(422, "A construction source URL is required before recording a verification date.", "PROJECT_SOURCE_REQUIRED");
  }
  if (input.constructionSourceUrl) {
    let source: URL;
    try { source = new URL(input.constructionSourceUrl); } catch { throw new HttpError(422, "Construction source must be a valid HTTP or HTTPS URL.", "PROJECT_SOURCE_INVALID"); }
    if (!new Set(["http:", "https:"]).has(source.protocol)) throw new HttpError(422, "Construction source must use HTTP or HTTPS.", "PROJECT_SOURCE_INVALID");
  }
  if (input.constructionSourceVerifiedAt && !Number.isFinite(new Date(input.constructionSourceVerifiedAt).getTime())) throw new HttpError(422, "Construction source verification time is invalid.", "PROJECT_SOURCE_DATE_INVALID");
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
  validateProjectEvidence(input);
  const startingPriceMinor = input.startingPriceMinor ? BigInt(input.startingPriceMinor) : null;
  if (startingPriceMinor !== null && (startingPriceMinor <= 0n || startingPriceMinor > 9_223_372_036_854_775_807n)) throw new HttpError(422, "Starting price must fit in a positive PostgreSQL minor-unit amount.", "PROJECT_PRICE_INVALID");

  try {
    return await db.$transaction(async (tx) => {
      const [developer, community] = await Promise.all([
        tx.developer.findFirst({ where: { id: input.developerId, ...catalogReadFilter(actor) }, select: { id: true } }),
        tx.community.findFirst({ where: { id: input.communityId, ...catalogReadFilter(actor) }, select: { id: true } }),
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
          launchDate: asDateOnly(input.launchDate),
          handoverDate: asDateOnly(input.handoverDate),
          completionPercent: input.completionPercent ?? null,
          constructionStatus: input.constructionStatus?.trim() || null,
          constructionSourceUrl: input.constructionSourceUrl?.trim() || null,
          constructionSourceVerifiedAt: input.constructionSourceVerifiedAt ? new Date(input.constructionSourceVerifiedAt) : null,
          totalUnits: input.totalUnits ?? null,
          startingPriceMinor,
          currency: input.currency?.trim().toUpperCase() || "AED",
          highlightsJson: JSON.stringify(input.highlights ?? []),
          keyAmenitiesJson: JSON.stringify(input.keyAmenities ?? []),
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
        launchDate: project.launchDate, handoverDate: project.handoverDate,
        completionPercent: project.completionPercent, constructionStatus: project.constructionStatus,
        constructionSourceUrl: project.constructionSourceUrl, constructionSourceVerifiedAt: project.constructionSourceVerifiedAt,
        totalUnits: project.totalUnits, startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
        currency: project.currency, highlights: input.highlights ?? [], keyAmenities: input.keyAmenities ?? [],
        publicationStatus: project.publicationStatus, brochureMediaId: project.brochureMediaId,
      };
      if (input.amenityIds?.length) {
        const matching = await tx.amenity.count({ where: { id: { in: [...new Set(input.amenityIds)] } } });
        if (matching !== new Set(input.amenityIds).size) throw new HttpError(422, "Choose valid project amenities.", "PROJECT_AMENITY_INVALID");
        await tx.projectAmenity.createMany({ data: [...new Set(input.amenityIds)].map((amenityId) => ({ projectId: project.id, amenityId })) });
      }
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
          community: { select: { id: true, publicationStatus: true } },
          developer: { select: { id: true } },
          media: { where: { section: "GALLERY" }, include: { media: { select: { kind: true, isPrivate: true } } } },
        },
      });
      if (!project || project.deletedAt) throw new HttpError(404, "Project not found", "NOT_FOUND");
      if (!canManageCatalogResource(actor, project.ownerOrganizationId)) throw new HttpError(403, "You cannot manage this project record.", "RESOURCE_FORBIDDEN");
      if (project.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This project changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const nextName = input.name?.trim() ?? project.name;
      const nextSlug = input.slug?.trim().toLowerCase() ?? project.slug;
      const nextDeveloper = input.developerId === undefined ? project.developer : await tx.developer.findFirst({ where: { id: input.developerId, ...catalogReadFilter(actor) }, select: { id: true } });
      const nextCommunity = input.communityId === undefined ? project.community : await tx.community.findFirst({ where: { id: input.communityId, ...catalogReadFilter(actor) }, select: { id: true, publicationStatus: true } });
      if (!nextDeveloper || !nextCommunity) throw new HttpError(422, "Choose an existing developer and community in your permitted scope.", "PROJECT_RELATION_REQUIRED");
      if (!nextName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
        throw new HttpError(422, "Project name and a URL-safe slug are required.", "PROJECT_VALIDATION");
      }
      if (input.publicationStatus === "PUBLISHED") {
        if (!nextName.trim()) throw new HttpError(422, "A project name is required before publishing.", "PUBLICATION_VALIDATION");
        if (nextCommunity.publicationStatus !== "PUBLISHED") {
          throw new HttpError(422, "The linked community must be published first.", "PUBLICATION_VALIDATION");
        }
        if (!Number.isFinite(project.lat) || project.lat < -90 || project.lat > 90 || !Number.isFinite(project.lng) || project.lng < -180 || project.lng > 180) {
          throw new HttpError(422, "Valid project coordinates are required before publishing.", "PUBLICATION_VALIDATION");
        }
        if (!(input.summary ?? project.summary)?.trim() || !(input.description ?? project.description)?.trim()) {
          throw new HttpError(422, "Add a project summary and description before publishing.", "PUBLICATION_VALIDATION");
        }
        if (!project.media.some((item) => item.media.kind === "IMAGE" && !item.media.isPrivate)) {
          throw new HttpError(422, "Add at least one public image to the project gallery before publishing.", "PUBLICATION_VALIDATION");
        }
      }
      validateProjectEvidence({
        launchDate: input.launchDate === undefined ? project.launchDate?.toISOString().slice(0, 10) ?? null : input.launchDate,
        handoverDate: input.handoverDate === undefined ? project.handoverDate?.toISOString().slice(0, 10) ?? null : input.handoverDate,
        completionPercent: input.completionPercent === undefined ? project.completionPercent : input.completionPercent,
        constructionSourceUrl: input.constructionSourceUrl === undefined ? project.constructionSourceUrl : input.constructionSourceUrl,
        constructionSourceVerifiedAt: input.constructionSourceVerifiedAt === undefined ? project.constructionSourceVerifiedAt?.toISOString() ?? null : input.constructionSourceVerifiedAt,
      });
      if (input.lat !== undefined && (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90)) throw new HttpError(422, "Latitude must be between -90 and 90.", "PROJECT_COORDINATES_INVALID");
      if (input.lng !== undefined && (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180)) throw new HttpError(422, "Longitude must be between -180 and 180.", "PROJECT_COORDINATES_INVALID");
      if (input.totalUnits != null && (!Number.isInteger(input.totalUnits) || input.totalUnits < 0)) throw new HttpError(422, "Total units must be a non-negative whole number.", "PROJECT_TOTAL_UNITS_INVALID");
      if (input.startingPriceMinor != null && (BigInt(input.startingPriceMinor) <= 0n || BigInt(input.startingPriceMinor) > 9_223_372_036_854_775_807n)) throw new HttpError(422, "Starting price must fit in a positive PostgreSQL minor-unit amount.", "PROJECT_PRICE_INVALID");
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
        launchDate: project.launchDate,
        handoverDate: project.handoverDate,
        completionPercent: project.completionPercent,
        constructionStatus: project.constructionStatus,
        constructionSourceUrl: project.constructionSourceUrl,
        constructionSourceVerifiedAt: project.constructionSourceVerifiedAt,
        totalUnits: project.totalUnits,
        startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
        currency: project.currency,
        lat: project.lat,
        lng: project.lng,
        locationPrecision: project.locationPrecision,
        highlightsJson: project.highlightsJson,
        keyAmenitiesJson: project.keyAmenitiesJson,
      };
      const data: Prisma.ProjectUncheckedUpdateManyInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = nextName;
      if (input.slug !== undefined) data.slug = nextSlug;
      if (input.developerId !== undefined) data.developerId = nextDeveloper.id;
      if (input.communityId !== undefined) data.communityId = nextCommunity.id;
      if (input.tagline !== undefined) data.tagline = input.tagline?.trim() || null;
      if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.projectType !== undefined) data.projectType = input.projectType;
      if (input.status !== undefined) data.status = input.status;
      if (input.publicationStatus !== undefined) data.publicationStatus = input.publicationStatus;
      if (input.brochureMediaId !== undefined) data.brochureMediaId = brochureMediaId;
      if (input.launchDate !== undefined) data.launchDate = asDateOnly(input.launchDate);
      if (input.handoverDate !== undefined) data.handoverDate = asDateOnly(input.handoverDate);
      if (input.completionPercent !== undefined) data.completionPercent = input.completionPercent;
      if (input.constructionStatus !== undefined) data.constructionStatus = input.constructionStatus?.trim() || null;
      if (input.constructionSourceUrl !== undefined) data.constructionSourceUrl = input.constructionSourceUrl?.trim() || null;
      if (input.constructionSourceVerifiedAt !== undefined) data.constructionSourceVerifiedAt = input.constructionSourceVerifiedAt ? new Date(input.constructionSourceVerifiedAt) : null;
      if (input.totalUnits !== undefined) data.totalUnits = input.totalUnits;
      if (input.startingPriceMinor !== undefined) data.startingPriceMinor = input.startingPriceMinor ? BigInt(input.startingPriceMinor) : null;
      if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase();
      if (input.highlights !== undefined) data.highlightsJson = JSON.stringify(input.highlights);
      if (input.keyAmenities !== undefined) data.keyAmenitiesJson = JSON.stringify(input.keyAmenities);
      if (input.lat !== undefined) data.lat = input.lat;
      if (input.lng !== undefined) data.lng = input.lng;
      if (input.locationPrecision !== undefined) data.locationPrecision = input.locationPrecision;

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
      if (input.amenityIds !== undefined) {
        const amenityIds = [...new Set(input.amenityIds)];
        const matching = await tx.amenity.count({ where: { id: { in: amenityIds } } });
        if (matching !== amenityIds.length) throw new HttpError(422, "Choose valid project amenities.", "PROJECT_AMENITY_INVALID");
        await tx.projectAmenity.deleteMany({ where: { projectId: project.id } });
        if (amenityIds.length) await tx.projectAmenity.createMany({ data: amenityIds.map((amenityId) => ({ projectId: project.id, amenityId })) });
      }

      const after = {
        developerId: input.developerId === undefined ? project.developerId : nextDeveloper.id,
        communityId: input.communityId === undefined ? project.communityId : nextCommunity.id,
        name: input.name === undefined ? project.name : nextName,
        slug: input.slug === undefined ? project.slug : nextSlug,
        tagline: input.tagline === undefined ? project.tagline : input.tagline?.trim() || null,
        summary: input.summary === undefined ? project.summary : input.summary?.trim() || null,
        description: input.description === undefined ? project.description : input.description?.trim() || null,
        projectType: input.projectType ?? project.projectType,
        status: input.status ?? project.status,
        publicationStatus: input.publicationStatus ?? project.publicationStatus,
        brochureMediaId,
        launchDate: input.launchDate === undefined ? project.launchDate : asDateOnly(input.launchDate),
        handoverDate: input.handoverDate === undefined ? project.handoverDate : asDateOnly(input.handoverDate),
        completionPercent: input.completionPercent === undefined ? project.completionPercent : input.completionPercent,
        constructionStatus: input.constructionStatus === undefined ? project.constructionStatus : input.constructionStatus?.trim() || null,
        constructionSourceUrl: input.constructionSourceUrl === undefined ? project.constructionSourceUrl : input.constructionSourceUrl?.trim() || null,
        constructionSourceVerifiedAt: input.constructionSourceVerifiedAt === undefined ? project.constructionSourceVerifiedAt : input.constructionSourceVerifiedAt ? new Date(input.constructionSourceVerifiedAt) : null,
        totalUnits: input.totalUnits === undefined ? project.totalUnits : input.totalUnits,
        startingPriceMinor: input.startingPriceMinor === undefined ? project.startingPriceMinor?.toString() ?? null : input.startingPriceMinor,
        currency: input.currency?.trim().toUpperCase() ?? project.currency,
        lat: input.lat ?? project.lat,
        lng: input.lng ?? project.lng,
        locationPrecision: input.locationPrecision ?? project.locationPrecision,
        highlights: input.highlights ?? safeArray(project.highlightsJson),
        keyAmenities: input.keyAmenities ?? safeArray(project.keyAmenitiesJson),
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

function safeArray(value: string | null): string[] {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

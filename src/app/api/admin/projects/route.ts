import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { createProjectCommand, updateProjectCommand } from "@/server/domain/project-command";
import { canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("project:read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const scope = catalogReadFilter(actor);
  const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const where = { deletedAt: null, AND: [scope, search] };
  const [projects, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        community: { select: { name: true } }, developer: { select: { name: true, verificationStatus: true } },
        media: { where: { section: { in: ["GALLERY", "PROGRESS"] } }, orderBy: { sortOrder: "asc" }, include: { media: { select: { url: true, altText: true } } } },
        amenities: { include: { amenity: { select: { id: true, name: true } } } },
        paymentPlans: { select: { id: true, verificationStatus: true, isDefault: true } },
        documents: { include: { media: { select: { url: true, mimeType: true, altText: true } } } },
      },
    }),
    db.project.count({ where }),
  ]);
  return NextResponse.json({
    total,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      tagline: project.tagline,
      summary: project.summary,
      description: project.description,
      projectType: project.projectType,
      developerId: project.developerId,
      communityId: project.communityId,
      status: project.status,
      publicationStatus: project.publicationStatus,
      brochureMediaId: project.brochureMediaId,
      gallery: project.media.filter((item) => item.section === "GALLERY").map((item) => ({ mediaId: item.mediaId, sortOrder: item.sortOrder, url: item.media.url, altText: item.media.altText })),
      progressGallery: project.media.filter((item) => item.section === "PROGRESS").map((item) => ({ mediaId: item.mediaId, sortOrder: item.sortOrder, url: item.media.url, altText: item.media.altText })),
      launchDate: project.launchDate?.toISOString().slice(0, 10) ?? null,
      handoverDate: project.handoverDate?.toISOString().slice(0, 10) ?? null,
      completionPercent: project.completionPercent,
      constructionStatus: project.constructionStatus,
      constructionSourceUrl: project.constructionSourceUrl,
      constructionSourceVerifiedAt: project.constructionSourceVerifiedAt?.toISOString() ?? null,
      totalUnits: project.totalUnits,
      startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
      currency: project.currency,
      lat: project.lat,
      lng: project.lng,
      locationPrecision: project.locationPrecision,
      highlights: safeStringArray(project.highlightsJson),
      keyAmenities: safeStringArray(project.keyAmenitiesJson),
      amenities: project.amenities.map((item) => ({ id: item.amenity.id, name: item.amenity.name, note: item.note })),
      paymentPlanCount: project.paymentPlans.length,
      publishedPaymentPlanCount: project.paymentPlans.filter((plan) => plan.verificationStatus === "PUBLISHED" || plan.verificationStatus === "VERIFIED").length,
      documents: project.documents.map((document) => ({ id: document.id, mediaId: document.mediaId, docType: document.docType, label: document.label, gated: document.gated, url: document.media.url, mimeType: document.media.mimeType })),
      developer: project.developer.name,
      developerVerificationStatus: project.developer.verificationStatus,
      community: project.community.name,
      canManage: canManageCatalogResource(actor, project.ownerOrganizationId),
      updatedAt: project.updatedAt.toISOString(),
    })),
  });
});

function safeStringArray(value: string | null): string[] {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

const patchSchema = z.object({
  projectId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  developerId: z.string().min(1).optional(),
  communityId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  tagline: z.string().max(300).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  projectType: z.enum(["RESIDENTIAL", "MIXED_USE", "HOSPITALITY", "COMMERCIAL"]).optional(),
  status: z.enum(["OFF_PLAN", "UNDER_CONSTRUCTION", "READY", "COMPLETED", "CANCELLED", "ON_HOLD"]).optional(),
  publicationStatus: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  brochureMediaId: z.string().min(1).nullable().optional(),
  launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  handoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completionPercent: z.number().finite().min(0).max(100).nullable().optional(),
  constructionStatus: z.string().max(200).nullable().optional(),
  constructionSourceUrl: z.string().max(2048).nullable().optional().refine((value) => !value || /^https?:\/\//i.test(value), { message: "Construction source must use HTTP or HTTPS." }),
  constructionSourceVerifiedAt: z.string().datetime().nullable().optional(),
  totalUnits: z.number().int().min(0).max(100000).nullable().optional(),
  startingPriceMinor: z.string().regex(/^\d+$/).max(19).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  highlights: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  keyAmenities: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  locationPrecision: z.enum(["EXACT", "BUILDING", "PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE"]).optional(),
  amenityIds: z.array(z.string().min(1)).max(100).optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "projectId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one project change.",
});

const createSchema = z.object({
  developerId: z.string().min(1),
  communityId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(160),
  tagline: z.string().max(300).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  projectType: z.enum(["RESIDENTIAL", "MIXED_USE", "HOSPITALITY", "COMMERCIAL"]),
  status: z.enum(["OFF_PLAN", "UNDER_CONSTRUCTION", "READY", "COMPLETED", "CANCELLED", "ON_HOLD"]),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  locationPrecision: z.enum(["EXACT", "BUILDING", "PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE"]),
  brochureMediaId: z.string().min(1).nullable().optional(),
  launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  handoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completionPercent: z.number().finite().min(0).max(100).nullable().optional(),
  constructionStatus: z.string().max(200).nullable().optional(),
  constructionSourceUrl: z.string().max(2048).nullable().optional().refine((value) => !value || /^https?:\/\//i.test(value), { message: "Construction source must use HTTP or HTTPS." }),
  constructionSourceVerifiedAt: z.string().datetime().nullable().optional(),
  totalUnits: z.number().int().min(0).max(100000).nullable().optional(),
  startingPriceMinor: z.string().regex(/^\d+$/).max(19).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  highlights: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  keyAmenities: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  amenityIds: z.array(z.string().min(1)).max(100).optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("project:create");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createProjectCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("project:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateProjectCommand(actor, input, clientIp(req)));
});

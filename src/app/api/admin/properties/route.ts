import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { createPropertyCommand, updatePropertyCommand } from "@/server/domain/property-command";
import { canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";
import { adminCatalogSourceView } from "@/server/domain/catalog-source";
import { entityMediaSchema, floorPlanAttachmentSchema } from "@/lib/media-contract";

export const dynamic = "force-dynamic";

function parseHighlights(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

/** Property management (Q05): list, publish/unpublish, price change with history + outbox */
export const GET = apiHandler(async (req) => {
  const user = await requirePermission("property:read");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const demo = url.searchParams.get("demo");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const scope = catalogReadFilter(user);
  const filters = {
    ...(status ? { publicationStatus: status } : {}),
    ...(q ? { title: { contains: q } } : {}),
    ...(demo === "demo" ? { OR: [{ isDemoData: true }, { sourceType: "DEMO_SEED" }] } : demo === "company" ? { isDemoData: false, sourceType: { not: "DEMO_SEED" } } : {}),
    deletedAt: null,
  };
  const where = { AND: [scope, filters] };

  const [properties, total] = await Promise.all([
    db.property.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 15,
      skip: (page - 1) * 15,
      include: {
        community: { select: { name: true } },
        listings: { orderBy: { createdAt: "desc" }, take: 1, include: { agent: { select: { name: true } }, statusHistory: { orderBy: { createdAt: "desc" }, take: 10 }, priceHistory: { orderBy: { recordedAt: "desc" }, take: 10 } } },
        media: { orderBy: { sortOrder: "asc" }, select: { mediaId: true, isCover: true, sortOrder: true, altText: true, caption: true, media: { select: { url: true, altText: true, caption: true, kind: true, mimeType: true, poster: { select: { url: true } } } } } },
        project: { select: { id: true, name: true } },
        developer: { select: { id: true, name: true } },
        amenities: { select: { amenityId: true } },
        floorPlans: { orderBy: { bedrooms: "asc" }, include: { media: { select: { url: true, altText: true, mimeType: true, kind: true } } } },
        documents: { where: { propertyId: { not: null } }, include: { media: { select: { url: true, mimeType: true } } } },
        priceHistory: { orderBy: { recordedAt: "desc" }, take: 10 },
        _count: { select: { media: true, dataQualityIssues: { where: { status: "OPEN" } } } },
      },
    }),
    db.property.count({ where }),
  ]);

  return NextResponse.json({
    total,
    page,
      properties: properties.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      shortDescription: p.shortDescription,
      subType: p.subType,
      builtUpAreaSqft: p.builtUpAreaSqft,
      plotAreaSqft: p.plotAreaSqft,
      furnishing: p.furnishing,
      view: p.view,
      floor: p.floor,
      totalFloors: p.totalFloors,
      handoverQuarter: p.handoverQuarter,
      addressLine: p.addressLine,
      reraPermit: p.reraPermit,
      titleDeedRef: p.titleDeedRef,
      highlights: parseHighlights(p.highlightsJson),
      projectId: p.projectId,
      projectName: p.project?.name ?? null,
      developerId: p.developerId,
      developerName: p.developer?.name ?? null,
      amenityIds: p.amenities.map((item) => item.amenityId),
      lat: p.lat,
      lng: p.lng,
      locationPrecision: p.locationPrecision,
      community: p.community.name,
      communityId: p.communityId,
      type: p.propertyType,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      publicationStatus: p.publicationStatus,
      priceMinor: p.listings[0]?.priceMinor?.toString() ?? null,
      currency: p.listings[0]?.currency ?? "AED",
      availability: p.listings[0]?.availabilityStatus ?? null,
      listingType: p.listings[0]?.listingType ?? null,
      rentFrequency: p.listings[0]?.rentFrequency ?? null,
      tenure: p.listings[0]?.tenure ?? null,
      priceQualifier: p.listings[0]?.priceQualifier ?? null,
      serviceChargePerSqft: p.listings[0]?.serviceChargePerSqft ?? null,
      offPlan: p.listings[0]?.offPlan ?? false,
      isExclusive: p.listings[0]?.isExclusive ?? false,
      agentId: p.listings[0]?.agentId ?? null,
      expiresAt: p.listings[0]?.expiresAt?.toISOString() ?? null,
      isFeaturedNow: p.listings[0]?.isFeatured ?? false,
      agent: canManageCatalogResource(user, p.ownerOrganizationId) ? p.listings[0]?.agent?.name ?? null : null,
      isDemoData: p.isDemoData,
      sourceType: p.sourceType,
      sourceUpdatedAt: p.sourceUpdatedAt?.toISOString() ?? null,
      retrievedAt: p.retrievedAt?.toISOString() ?? null,
      mediaCount: p._count.media,
      coverMediaId: p.media.find((item) => item.isCover)?.mediaId ?? null,
      cover: p.media.find((item) => item.isCover) ? { url: p.media.find((item) => item.isCover)!.media.url, altText: p.media.find((item) => item.isCover)!.media.altText } : null,
      gallery: p.media.map((item) => ({ mediaId: item.mediaId, isCover: item.isCover, sortOrder: item.sortOrder, url: item.media.url, altText: item.altText ?? item.media.altText, caption: item.caption ?? item.media.caption, kind: item.media.kind, mimeType: item.media.mimeType, posterUrl: item.media.poster?.url ?? null })),
      floorPlans: p.floorPlans.map((item) => ({ id: item.id, mediaId: item.mediaId, bedrooms: item.bedrooms, areaSqft: item.areaSqft, priceMinor: item.priceMinor?.toString() ?? null, label: item.label, url: item.media.url, mimeType: item.media.mimeType, kind: item.media.kind })),
      documents: p.documents.map((item) => ({ id: item.id, mediaId: item.mediaId, docType: item.docType, label: item.label, gated: item.gated, url: item.media.url, mimeType: item.media.mimeType })),
      priceHistory: p.priceHistory.map((item) => ({ priceMinor: item.priceMinor.toString(), currency: item.currency, sourceType: item.sourceType, recordedAt: item.recordedAt.toISOString() })),
      statusHistory: (p.listings[0]?.statusHistory ?? []).map((item) => ({ fromStatus: item.fromStatus, toStatus: item.toStatus, reason: item.reason, createdAt: item.createdAt.toISOString() })),
      openIssues: p._count.dataQualityIssues,
      canManage: canManageCatalogResource(user, p.ownerOrganizationId),
      ...adminCatalogSourceView({
        propertySourceSnapshotJson: p.sourceSnapshotJson,
        propertyEditorOverridesJson: p.editorOverridesJson,
        listingSourceSnapshotJson: p.listings[0]?.sourceSnapshotJson,
        listingEditorOverridesJson: p.listings[0]?.editorOverridesJson,
      }),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
});

const patchSchema = z.object({
  ...entityMediaSchema,
  floorPlans: z.array(floorPlanAttachmentSchema).max(30).optional(),
  propertyId: z.string(),
  expectedUpdatedAt: z.string().datetime(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  propertyType: z.string().trim().min(1).max(60).optional(),
  bedrooms: z.number().min(0).max(30).optional(),
  bathrooms: z.number().min(0).max(30).optional(),
  publicationStatus: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "UNPUBLISHED"]).optional(),
  priceAed: z.number().finite().positive().max(1_000_000_000).optional(),
  availabilityStatus: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"]).optional(),
  resetSourceFields: z.array(z.enum(["title", "description", "propertyType", "bedrooms", "bathrooms", "priceAed", "availabilityStatus"])).max(7).optional(),
  isFeatured: z.boolean().optional(),
  coverMediaId: z.string().min(1).nullable().optional(),
  subType: z.string().trim().max(80).nullable().optional(),
  builtUpAreaSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  plotAreaSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  furnishing: z.enum(["FURNISHED", "SEMI_FURNISHED", "UNFURNISHED"]).nullable().optional(),
  view: z.enum(["SEA", "MARINA", "SKYLINE", "GOLF", "PARK", "COMMUNITY"]).nullable().optional(),
  floor: z.number().int().min(-10).max(300).nullable().optional(),
  totalFloors: z.number().int().min(1).max(300).nullable().optional(),
  handoverQuarter: z.string().trim().max(40).nullable().optional(),
  addressLine: z.string().trim().max(500).nullable().optional(),
  shortDescription: z.string().max(2000).nullable().optional(),
  reraPermit: z.string().trim().max(120).nullable().optional(),
  titleDeedRef: z.string().trim().max(160).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(240)).max(30).optional(),
  projectId: z.string().min(1).nullable().optional(),
  developerId: z.string().min(1).nullable().optional(),
  tenure: z.enum(["FREEHOLD", "LEASEHOLD"]).nullable().optional(),
  priceQualifier: z.string().trim().max(80).nullable().optional(),
  serviceChargePerSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  offPlan: z.boolean().optional(),
  isExclusive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  agentId: z.string().min(1).nullable().optional(),
  amenityIds: z.array(z.string().min(1)).max(100).optional(),
  communityId: z.string().min(1).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  locationPrecision: z.enum(["EXACT", "BUILDING", "PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE"]).optional(),
  listingType: z.enum(["SALE", "RENT", "SHORT_TERM"]).optional(),
  rentFrequency: z.enum(["YEARLY", "MONTHLY", "WEEKLY", "DAILY"]).nullable().optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "propertyId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one property change.",
});

const createSchema = z.object({
  publicationStatus: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  ...entityMediaSchema,
  floorPlans: z.array(floorPlanAttachmentSchema).max(30).optional(),
  communityId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(160),
  description: z.string().max(10000).nullable().optional(),
  propertyType: z.enum(["APARTMENT", "VILLA", "TOWNHOUSE", "PENTHOUSE", "DUPLEX", "STUDIO", "OFFICE", "RETAIL", "PLOT"]),
  bedrooms: z.number().finite().min(0).max(30),
  bathrooms: z.number().finite().min(0).max(30),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  locationPrecision: z.enum(["EXACT", "BUILDING", "PROJECT", "COMMUNITY_CENTROID", "APPROXIMATE"]),
  listingType: z.enum(["SALE", "RENT", "SHORT_TERM"]),
  rentFrequency: z.enum(["YEARLY", "MONTHLY", "WEEKLY", "DAILY"]).nullable().optional(),
  priceAed: z.number().finite().positive().max(1_000_000_000),
  availabilityStatus: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "HELD", "WITHDRAWN"]),
  coverMediaId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  developerId: z.string().min(1).nullable().optional(),
  subType: z.string().trim().max(80).nullable().optional(),
  builtUpAreaSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  plotAreaSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  furnishing: z.enum(["FURNISHED", "SEMI_FURNISHED", "UNFURNISHED"]).nullable().optional(),
  view: z.enum(["SEA", "MARINA", "SKYLINE", "GOLF", "PARK", "COMMUNITY"]).nullable().optional(),
  floor: z.number().int().min(-10).max(300).nullable().optional(),
  totalFloors: z.number().int().min(1).max(300).nullable().optional(),
  handoverQuarter: z.string().trim().max(40).nullable().optional(),
  addressLine: z.string().trim().max(500).nullable().optional(),
  shortDescription: z.string().max(2000).nullable().optional(),
  reraPermit: z.string().trim().max(120).nullable().optional(),
  titleDeedRef: z.string().trim().max(160).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(240)).max(30).optional(),
  tenure: z.enum(["FREEHOLD", "LEASEHOLD"]).nullable().optional(),
  priceQualifier: z.string().trim().max(80).nullable().optional(),
  serviceChargePerSqft: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  offPlan: z.boolean().optional(),
  isExclusive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  agentId: z.string().min(1).nullable().optional(),
  amenityIds: z.array(z.string().min(1)).max(100).optional(),
}).strict().refine((input) => input.listingType !== "RENT" || Boolean(input.rentFrequency), {
  message: "Rent frequency is required for rental listings.",
  path: ["rentFrequency"],
});

export const POST = apiHandler(async (req) => {
  const user = await requirePermission("property:create");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createPropertyCommand(user, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const user = await requirePermission("property:update");
  const raw = await jsonBody<z.infer<typeof patchSchema>>(req);
  const input = patchSchema.parse(raw);
  const result = await updatePropertyCommand(user, input, clientIp(req));
  return NextResponse.json(result);
});

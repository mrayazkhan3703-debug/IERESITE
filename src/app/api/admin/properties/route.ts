import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { createPropertyCommand, updatePropertyCommand } from "@/server/domain/property-command";
import { canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";
import { adminCatalogSourceView } from "@/server/domain/catalog-source";

export const dynamic = "force-dynamic";

/** Property management (Q05): list, publish/unpublish, price change with history + outbox */
export const GET = apiHandler(async (req) => {
  const user = await requirePermission("property:read");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const scope = catalogReadFilter(user);
  const filters = {
    ...(status ? { publicationStatus: status } : {}),
    ...(q ? { title: { contains: q } } : {}),
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
        listings: { orderBy: { createdAt: "desc" }, take: 1, include: { agent: { select: { name: true } } } },
        media: { where: { isCover: true }, orderBy: { sortOrder: "asc" }, take: 1, select: { mediaId: true, media: { select: { url: true, altText: true } } } },
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
      community: p.community.name,
      type: p.propertyType,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      publicationStatus: p.publicationStatus,
      priceMinor: p.listings[0]?.priceMinor?.toString() ?? null,
      currency: p.listings[0]?.currency ?? "AED",
      availability: p.listings[0]?.availabilityStatus ?? null,
      isFeaturedNow: p.listings[0]?.isFeatured ?? false,
      agent: canManageCatalogResource(user, p.ownerOrganizationId) ? p.listings[0]?.agent?.name ?? null : null,
      isDemoData: p.isDemoData,
      sourceType: p.sourceType,
      mediaCount: p._count.media,
      coverMediaId: p.media[0]?.mediaId ?? null,
      cover: p.media[0] ? { url: p.media[0].media.url, altText: p.media[0].media.altText } : null,
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
}).strict().refine((input) => Object.keys(input).some((key) => key !== "propertyId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one property change.",
});

const createSchema = z.object({
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { createCommunityCommand, updateCommunityCommand } from "@/server/domain/community-command";
import { canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("community:read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const scope = catalogReadFilter(actor);
  const where = q ? { AND: [scope, { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] }] } : scope;
  const [communities, total] = await Promise.all([
    db.community.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { projects: { where: { publicationStatus: "PUBLISHED", deletedAt: null } } } } },
    }),
    db.community.count({ where }),
  ]);
  return NextResponse.json({
    total,
    communities: communities.map((community) => ({
      id: community.id, name: community.name, slug: community.slug, summary: community.summary,
      description: community.description, areaType: community.areaType, lat: community.lat, lng: community.lng,
      imageMediaId: community.imageMediaId,
      publicationStatus: community.publicationStatus, publishedProjectCount: community._count.projects,
      updatedAt: community.updatedAt.toISOString(), canManage: canManageCatalogResource(actor, community.ownerOrganizationId),
    })),
  });
});

const patchSchema = z.object({
  communityId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  areaType: z.enum(["RESIDENTIAL", "BUSINESS", "WATERFRONT", "ISLAND", "SUBURBAN", "INDUSTRIAL"]).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  publicationStatus: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "UNPUBLISHED"]).optional(),
  imageMediaId: z.string().min(1).nullable().optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "communityId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one community change.",
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(160),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  areaType: z.enum(["RESIDENTIAL", "BUSINESS", "WATERFRONT", "ISLAND", "SUBURBAN", "INDUSTRIAL"]),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  locationPrecision: z.enum(["EXACT", "COMMUNITY_CENTROID", "APPROXIMATE"]),
  imageMediaId: z.string().min(1).nullable().optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("community:create");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createCommunityCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("community:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateCommunityCommand(actor, input, clientIp(req)));
});

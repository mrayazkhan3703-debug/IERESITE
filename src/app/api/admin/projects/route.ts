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
      include: { community: { select: { name: true } }, developer: { select: { name: true } } },
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
      status: project.status,
      publicationStatus: project.publicationStatus,
      brochureMediaId: project.brochureMediaId,
      developer: project.developer.name,
      community: project.community.name,
      startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
      currency: project.currency,
      canManage: canManageCatalogResource(actor, project.ownerOrganizationId),
      updatedAt: project.updatedAt.toISOString(),
    })),
  });
});

const patchSchema = z.object({
  projectId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  tagline: z.string().max(300).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  projectType: z.enum(["RESIDENTIAL", "MIXED_USE", "HOSPITALITY", "COMMERCIAL"]).optional(),
  status: z.enum(["OFF_PLAN", "UNDER_CONSTRUCTION", "READY", "COMPLETED", "CANCELLED", "ON_HOLD"]).optional(),
  publicationStatus: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  brochureMediaId: z.string().min(1).nullable().optional(),
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

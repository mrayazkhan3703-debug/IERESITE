import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { createDeveloperCommand, updateDeveloperCommand } from "@/server/domain/developer-command";
import { canManageCatalogResource, catalogReadFilter } from "@/server/domain/resource-policy";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("developer:read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const scope = catalogReadFilter(actor);
  const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const where = { AND: [scope, search] };
  const [developers, total] = await Promise.all([
    db.developer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { projects: { where: { publicationStatus: "PUBLISHED", deletedAt: null } } } } },
    }),
    db.developer.count({ where }),
  ]);
  return NextResponse.json({
    total,
    developers: developers.map((developer) => ({
      id: developer.id, name: developer.name, slug: developer.slug, summary: developer.summary,
      description: developer.description, websiteUrl: developer.websiteUrl, headquarters: developer.headquarters,
      foundedYear: developer.foundedYear, verificationStatus: developer.verificationStatus,
      logoMediaId: developer.logoMediaId,
      lastVerifiedAt: developer.lastVerifiedAt?.toISOString() ?? null,
      publishedProjectCount: developer._count.projects, updatedAt: developer.updatedAt.toISOString(),
      canManage: canManageCatalogResource(actor, developer.ownerOrganizationId),
    })),
  });
});

const developerFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(160),
  summary: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  websiteUrl: z.string().max(2048).nullable().optional().refine((value) => !value || /^https?:\/\//i.test(value), { message: "Website must use HTTP or HTTPS." }),
  headquarters: z.string().max(200).nullable().optional(),
  foundedYear: z.number().int().min(1000).max(new Date().getFullYear()).nullable().optional(),
  logoMediaId: z.string().min(1).nullable().optional(),
}).strict();

const createSchema = developerFieldsSchema;

const patchSchema = developerFieldsSchema.partial().extend({
  developerId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "developerId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one developer change.",
});

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("developer:create");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createDeveloperCommand(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("developer:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateDeveloperCommand(actor, input, clientIp(req)));
});

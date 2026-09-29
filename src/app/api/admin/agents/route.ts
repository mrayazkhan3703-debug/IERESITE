import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { agentProfileScope } from "@/server/domain/resource-policy";
import { hasGrantedPermission } from "@/server/authz-policy";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";
import { catalogReadFilter } from "@/server/domain/resource-policy";

const specialtySchema = z.enum(["OFF_PLAN", "LUXURY", "INVESTMENT", "SECONDARY", "COMMERCIAL", "RELOCATION", "RESIDENTIAL", "RENTALS", "PROPERTY_MANAGEMENT"]);

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("agent:read");
  const canCreate = hasGrantedPermission(actor.permissions, "agent:create");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const where = { AND: [agentProfileScope(actor), search] };
  const [agents, total, linkableUsers] = await Promise.all([
    db.agent.findMany({ where, orderBy: [{ sortWeight: "desc" }, { name: "asc" }], take: 50, include: {
      user: { select: { email: true, emailVerified: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } },
      languageRecords: { orderBy: { name: "asc" } }, specialtyRecords: { orderBy: { specialty: "asc" } },
      communities: { include: { community: { select: { id: true, name: true, slug: true } } } },
      listings: { where: { property: { deletedAt: null } }, select: { property: { select: { project: { select: { id: true, name: true, slug: true } } } } } },
    } }),
    db.agent.count({ where }),
    canCreate ? db.user.findMany({
      where: {
        isActive: true,
        emailVerified: { not: null },
        agent: null,
        roles: { some: { role: { key: "AGENT" } } },
        ...(!actor.roles.includes("OWNER") ? { organizationId: actor.organizationId ?? "__no_organization__" } : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: 100,
    }) : Promise.resolve([]),
  ]);
  const communities = canCreate ? await db.community.findMany({ where: { AND: [catalogReadFilter(actor), { publicationStatus: { not: "ARCHIVED" } }] }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" }, take: 100 }) : [];
  return NextResponse.json({
    total,
    ...(canCreate ? { linkableUsers } : {}),
    communities,
    agents: agents.map((agent) => ({
      id: agent.id, name: agent.name, slug: agent.slug, jobTitle: agent.jobTitle, bio: agent.bio,
      department: agent.department, yearsExperience: agent.yearsExperience, active: agent.active,
      publicAdvisor: agent.publicAdvisor, updatedAt: agent.updatedAt.toISOString(),
      photoMediaId: agent.photoMediaId,
      phoneE164: agent.phoneE164, whatsappE164: agent.whatsappE164, email: agent.email,
      linkedAccountEmail: agent.user?.email ?? null, linkedAccountVerified: Boolean(agent.user?.emailVerified),
      linkedAccountActive: Boolean(agent.user?.isActive), linkedAccountRoles: agent.user?.roles.map(({ role }) => role.key) ?? [],
      languages: agent.languageRecords.map(({ code, name, fluency }) => ({ code, name, fluency })),
      specialties: agent.specialtyRecords.map(({ specialty }) => specialty),
      communities: agent.communities.map(({ community }) => community),
      assignedProjects: [...new Map(agent.listings.map(({ property }) => property.project).filter((project): project is { id: string; name: string; slug: string } => project !== null).map((project) => [project.id, project])).values()],
    })),
  });
});

const createSchema = z.object({
  userId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  jobTitle: z.string().trim().min(1).max(120),
  bio: z.string().max(5000).optional(),
  department: z.enum(["leadership", "sales", "marketing", "hr", "admin", "other"]).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  photoMediaId: z.string().min(1).nullable().optional(),
  phoneE164: z.string().trim().max(16).nullable().optional(),
  whatsappE164: z.string().trim().max(16).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  languages: z.array(z.object({ code: z.string().trim().regex(/^[A-Za-z]{2,3}$/), name: z.string().trim().min(1).max(100), fluency: z.enum(["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"]) }).strict()).max(30).optional(),
  specialties: z.array(specialtySchema).max(40).optional(),
  communityIds: z.array(z.string().min(1).max(100)).max(100).optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("agent:create");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createAgentProfileCommand(actor, input, clientIp(req)), { status: 201 });
});

const patchSchema = z.object({
  agentId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  jobTitle: z.string().trim().min(1).max(120).optional(),
  bio: z.string().max(5000).optional(),
  department: z.enum(["leadership", "sales", "marketing", "hr", "admin", "other"]).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  active: z.boolean().optional(),
  publicAdvisor: z.boolean().optional(),
  photoMediaId: z.string().min(1).nullable().optional(),
  phoneE164: z.string().trim().max(16).nullable().optional(),
  whatsappE164: z.string().trim().max(16).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  languages: z.array(z.object({ code: z.string().trim().regex(/^[A-Za-z]{2,3}$/), name: z.string().trim().min(1).max(100), fluency: z.enum(["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"]) }).strict()).max(30).optional(),
  specialties: z.array(specialtySchema).max(40).optional(),
  communityIds: z.array(z.string().min(1).max(100)).max(100).optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "agentId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one team profile change.",
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("agent:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateAgentCommand(actor, input, clientIp(req)));
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { peopleAdminWhere, peopleFilter } from "@/server/domain/agent-directory";
import { PUBLIC_AGENT_WHERE, PUBLIC_PROFILE_WHERE } from "@/server/domain/visibility";
import { hasGrantedPermission } from "@/server/authz-policy";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";
import { catalogReadFilter } from "@/server/domain/resource-policy";

const specialtySchema = z.enum(["OFF_PLAN", "LUXURY", "INVESTMENT", "SECONDARY", "COMMERCIAL", "RELOCATION", "RESIDENTIAL", "RENTALS", "PROPERTY_MANAGEMENT"]);

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("agent:read");
  const canCreate = hasGrantedPermission(actor.permissions, "agent:create");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const filter = peopleFilter(url.searchParams.get("filter"));
  const pageValue = Number(url.searchParams.get("page") ?? 1);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1;
  const where = peopleAdminWhere(actor, q, filter);
  const [agents, total, linkableUsers] = await Promise.all([
    db.agent.findMany({ where, orderBy: [{ sortWeight: "desc" }, { name: "asc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50, include: {
      user: { select: { email: true, emailVerified: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } },
      languageRecords: { orderBy: { name: "asc" } }, specialtyRecords: { orderBy: { specialty: "asc" } },
      communities: { include: { community: { select: { id: true, name: true, slug: true } } } },
      listings: { where: { property: { deletedAt: null } }, select: { propertyId: true, property: { select: { project: { select: { id: true, name: true, slug: true } } } } } },
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
  const ids = agents.map(agent => agent.id);
  const [eligible, visible] = await Promise.all([
    db.agent.findMany({ where: { AND: [{ id: { in: ids } }, PUBLIC_AGENT_WHERE] }, select: { id: true } }),
    db.agent.findMany({ where: { AND: [{ id: { in: ids } }, PUBLIC_PROFILE_WHERE] }, select: { id: true } }),
  ]);
  const eligibleIds = new Set(eligible.map(agent => agent.id));
  const visibleIds = new Set(visible.map(agent => agent.id));
  return NextResponse.json({
    total, page, pageSize: 50, filter,
    ...(canCreate ? { linkableUsers } : {}),
    communities,
    agents: agents.map((agent) => ({
      id: agent.id, name: agent.name, slug: agent.slug, jobTitle: agent.jobTitle, bio: agent.bio,
      department: agent.department, yearsExperience: agent.yearsExperience, active: agent.active,
      publicAdvisor: agent.publicAdvisor, publicTeam: agent.publicTeam, updatedAt: agent.updatedAt.toISOString(),
      photoMediaId: agent.photoMediaId, photoUrl: agent.photoMediaId ? `/api/media/${agent.photoMediaId}/content` : agent.photoUrl,
      userId: agent.userId, advisorEligible: eligibleIds.has(agent.id), publicVisible: visibleIds.has(agent.id),
      assignedPropertyCount: new Set(agent.listings.map(listing => listing.propertyId)).size,
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
  active: z.boolean().optional(),
  publicAdvisor: z.boolean().optional(),
  userId: z.string().min(1).max(100).nullable().optional(),
  publicTeam: z.boolean().optional(),
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
  userId: z.string().min(1).max(100).nullable().optional(),
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
  publicTeam: z.boolean().optional(),
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

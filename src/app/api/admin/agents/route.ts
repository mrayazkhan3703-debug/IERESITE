import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { agentProfileScope } from "@/server/domain/resource-policy";
import { hasGrantedPermission } from "@/server/authz-policy";
import { createAgentProfileCommand, updateAgentCommand } from "@/server/domain/agent-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const actor = await requirePermission("agent:read");
  const canCreate = hasGrantedPermission(actor.permissions, "agent:create");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const where = { AND: [agentProfileScope(actor), search] };
  const [agents, total, linkableUsers] = await Promise.all([
    db.agent.findMany({ where, orderBy: [{ sortWeight: "desc" }, { name: "asc" }], take: 50 }),
    db.agent.count({ where }),
    canCreate ? db.user.findMany({
      where: {
        isActive: true,
        agent: null,
        roles: { some: { role: { key: "AGENT" } } },
        ...(!actor.roles.includes("OWNER") ? { organizationId: actor.organizationId ?? "__no_organization__" } : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: 100,
    }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    total,
    ...(canCreate ? { linkableUsers } : {}),
    agents: agents.map((agent) => ({
      id: agent.id, name: agent.name, slug: agent.slug, jobTitle: agent.jobTitle, bio: agent.bio,
      department: agent.department, yearsExperience: agent.yearsExperience, active: agent.active,
      publicAdvisor: agent.publicAdvisor, updatedAt: agent.updatedAt.toISOString(),
      photoMediaId: agent.photoMediaId,
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
}).strict().refine((input) => Object.keys(input).some((key) => key !== "agentId" && key !== "expectedUpdatedAt"), {
  message: "Provide at least one team profile change.",
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("agent:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateAgentCommand(actor, input, clientIp(req)));
});

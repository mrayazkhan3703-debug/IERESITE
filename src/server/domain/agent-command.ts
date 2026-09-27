import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { hasGrantedPermission } from "@/server/authz-policy";
import { emitEvent } from "@/server/jobs/outbox";
import { canManageAgentProfile } from "@/server/domain/resource-policy";
import { requirePublicMedia } from "@/server/domain/media-policy";

export interface AgentCommandInput {
  agentId: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  jobTitle?: string;
  bio?: string;
  department?: string | null;
  yearsExperience?: number;
  active?: boolean;
  publicAdvisor?: boolean;
  photoMediaId?: string | null;
}

export interface AgentCreateCommandInput {
  userId: string;
  name: string;
  slug: string;
  jobTitle: string;
  bio?: string;
  department?: string | null;
  yearsExperience?: number;
  photoMediaId?: string | null;
}

/** Create an unpublished team profile only for a real, active AGENT account. */
export async function createAgentProfileCommand(actor: SessionUser, input: AgentCreateCommandInput, ip: string | null) {
  if (!hasGrantedPermission(actor.permissions, "agent:create")) {
    throw new HttpError(403, "You do not have permission to create team profiles.", "FORBIDDEN");
  }
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const jobTitle = input.jobTitle.trim();
  const bio = input.bio?.trim() ?? "";
  if (!name || !jobTitle || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) {
    throw new HttpError(422, "Name, job title, and a URL-safe slug are required.", "AGENT_VALIDATION");
  }
  if (input.yearsExperience !== undefined && (!Number.isInteger(input.yearsExperience) || input.yearsExperience < 0 || input.yearsExperience > 80)) {
    throw new HttpError(422, "Years of experience must be between 0 and 80.", "AGENT_VALIDATION");
  }

  try {
    return await db.$transaction(async (tx) => {
      const linkedUser = await tx.user.findFirst({
        where: {
          id: input.userId,
          isActive: true,
          agent: null,
          roles: { some: { role: { key: "AGENT" } } },
          ...(!actor.roles.includes("OWNER") ? { organizationId: actor.organizationId ?? "__no_organization__" } : {}),
        },
        select: { id: true, organizationId: true },
      });
      if (!linkedUser) {
        throw new HttpError(422, "Choose an active AGENT account in your permitted organization that has no team profile.", "INVALID_AGENT_ACCOUNT");
      }
      const photoMediaId = await requirePublicMedia(tx, input.photoMediaId, ["IMAGE"]);
      const agent = await tx.agent.create({
        data: {
          userId: linkedUser.id,
          name,
          slug,
          jobTitle,
          bio,
          department: input.department?.trim() || null,
          yearsExperience: input.yearsExperience ?? 0,
          photoMediaId,
          active: false,
          publicAdvisor: false,
        },
      });
      const after = {
        userId: linkedUser.id, name, slug, jobTitle, bio,
        department: input.department?.trim() || null,
        yearsExperience: input.yearsExperience ?? 0,
        photoMediaId, active: false, publicAdvisor: false,
      };
      await audit({
        actorId: actor.id, organizationId: linkedUser.organizationId,
        action: "agent.create", resourceType: "agent", resourceId: agent.id,
        before: null, after, ip,
      }, tx);
      await emitEvent("agent", agent.id, "agent.created", { agentId: agent.id, by: actor.email }, tx);
      return { ok: true as const, agentId: agent.id, updatedAt: agent.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That account already has a team profile or the profile slug is already in use.", "AGENT_PROFILE_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "The account changed during profile creation. Refresh and retry.", "AGENT_PROFILE_CONFLICT");
    }
    throw error;
  }
}

export async function updateAgentCommand(actor: SessionUser, input: AgentCommandInput, ip: string | null) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid team profile version", "INVALID_VERSION");

  try {
    return await db.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id: input.agentId },
        include: { user: { select: { organizationId: true } } },
      });
      if (!agent) throw new HttpError(404, "Team profile not found", "NOT_FOUND");
      if (!canManageAgentProfile(actor, agent.user?.organizationId ?? null)) throw new HttpError(403, "You cannot manage this team profile.", "RESOURCE_FORBIDDEN");
      if (agent.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This team profile changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const name = input.name?.trim() ?? agent.name;
      const slug = input.slug?.trim().toLowerCase() ?? agent.slug;
      const jobTitle = input.jobTitle?.trim() ?? agent.jobTitle;
      const bio = input.bio?.trim() ?? agent.bio;
      const active = input.active ?? agent.active;
      const publicAdvisor = input.publicAdvisor ?? agent.publicAdvisor;
      if (!name || !jobTitle || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new HttpError(422, "Name, job title, and a URL-safe slug are required.", "AGENT_VALIDATION");
      }
      if (publicAdvisor && (!active || !bio.trim())) {
        throw new HttpError(422, "A public advisor must be active and have a profile bio.", "PUBLICATION_VALIDATION");
      }
      const photoMediaId = input.photoMediaId === undefined
        ? agent.photoMediaId
        : await requirePublicMedia(tx, input.photoMediaId, ["IMAGE"]);

      const before = {
        name: agent.name, slug: agent.slug, jobTitle: agent.jobTitle, bio: agent.bio,
        department: agent.department, yearsExperience: agent.yearsExperience, active: agent.active, publicAdvisor: agent.publicAdvisor,
        photoMediaId: agent.photoMediaId,
      };
      const data: Prisma.AgentUpdateManyMutationInput = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = name;
      if (input.slug !== undefined) data.slug = slug;
      if (input.jobTitle !== undefined) data.jobTitle = jobTitle;
      if (input.bio !== undefined) data.bio = bio;
      if (input.department !== undefined) data.department = input.department?.trim() || null;
      if (input.yearsExperience !== undefined) data.yearsExperience = input.yearsExperience;
      if (input.active !== undefined) data.active = active;
      if (input.publicAdvisor !== undefined) data.publicAdvisor = publicAdvisor;
      if (input.photoMediaId !== undefined) data.photoMediaId = photoMediaId;

      const changed = await tx.agent.updateMany({ where: { id: agent.id, updatedAt: expectedUpdatedAt }, data });
      if (changed.count !== 1) throw new HttpError(409, "This team profile changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");

      if (slug !== agent.slug) {
        const fromPath = `/agents/${agent.slug}`;
        const toPath = `/agents/${slug}`;
        await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
        const redirect = await tx.redirect.findUnique({ where: { fromPath } });
        if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Team profile slug changed in Admin" } });
        else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Team profile slug changed in Admin" } });
      }

      const after = {
        name, slug, jobTitle, bio,
        department: input.department === undefined ? agent.department : input.department?.trim() || null,
        yearsExperience: input.yearsExperience ?? agent.yearsExperience, active, publicAdvisor,
        photoMediaId,
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "agent.update", resourceType: "agent", resourceId: agent.id, before, after, ip }, tx);
      await emitEvent("agent", agent.id, "agent.updated", { agentId: agent.id, by: actor.email }, tx);
      const updated = await tx.agent.findUniqueOrThrow({ where: { id: agent.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That team profile slug is already in use.", "SLUG_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This team profile changed during the save. Refresh and review the latest values.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

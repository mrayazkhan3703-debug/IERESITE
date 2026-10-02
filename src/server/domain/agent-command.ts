import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import { HttpError, audit } from "@/server/auth";
import { hasGrantedPermission } from "@/server/authz-policy";
import { emitEvent } from "@/server/jobs/outbox";
import { canManageAgentProfile, canManageCatalogResource } from "@/server/domain/resource-policy";
import { requirePublicMedia } from "@/server/domain/media-policy";

export interface AgentCommandInput {
  userId?: string | null;
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
  publicTeam?: boolean;
  photoMediaId?: string | null;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  email?: string | null;
  languages?: { code: string; name: string; fluency: "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE" }[];
  specialties?: string[];
  communityIds?: string[];
}

export interface AgentCreateCommandInput {
  userId?: string | null;
  active?: boolean;
  publicAdvisor?: boolean;
  publicTeam?: boolean;
  name: string;
  slug: string;
  jobTitle: string;
  bio?: string;
  department?: string | null;
  yearsExperience?: number;
  photoMediaId?: string | null;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  email?: string | null;
  languages?: { code: string; name: string; fluency: "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE" }[];
  specialties?: string[];
  communityIds?: string[];
}

function validateAdvisorFacts(input: { phoneE164?: string | null; whatsappE164?: string | null; email?: string | null; languages?: { code: string; name: string; fluency: string }[]; specialties?: string[]; communityIds?: string[] }) {
  for (const phone of [input.phoneE164, input.whatsappE164]) if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new HttpError(422, "Advisor contact numbers must use E.164 format (for example +971501234567).", "AGENT_CONTACT_INVALID");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new HttpError(422, "Enter a valid public contact email.", "AGENT_CONTACT_INVALID");
  if (input.languages && (input.languages.length > 30 || new Set(input.languages.map((row) => row.code.toLowerCase())).size !== input.languages.length)) throw new HttpError(422, "Languages must use unique codes and contain no more than 30 entries.", "AGENT_LANGUAGES_INVALID");
  if (input.specialties && (input.specialties.length > 40 || new Set(input.specialties).size !== input.specialties.length)) throw new HttpError(422, "Specialties must be unique and contain no more than 40 entries.", "AGENT_SPECIALTIES_INVALID");
  if (input.communityIds && (input.communityIds.length > 100 || new Set(input.communityIds).size !== input.communityIds.length)) throw new HttpError(422, "Communities must be unique and contain no more than 100 entries.", "AGENT_COMMUNITIES_INVALID");
}

async function replaceAdvisorRelations(tx: Prisma.TransactionClient, actor: SessionUser, agentId: string, input: { languages?: { code: string; name: string; fluency: "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE" }[]; specialties?: string[]; communityIds?: string[] }) {
  if (input.languages !== undefined) {
    await tx.agentLanguage.deleteMany({ where: { agentId } });
    if (input.languages.length) await tx.agentLanguage.createMany({ data: input.languages.map((language) => ({ agentId, code: language.code.toLowerCase(), name: language.name.trim(), fluency: language.fluency })) });
  }
  if (input.specialties !== undefined) {
    await tx.agentSpecialty.deleteMany({ where: { agentId } });
    if (input.specialties.length) await tx.agentSpecialty.createMany({ data: input.specialties.map((specialty) => ({ agentId, specialty })) });
  }
  if (input.communityIds !== undefined) {
    const ids = [...new Set(input.communityIds)];
    const communities = await tx.community.findMany({ where: { id: { in: ids }, publicationStatus: { not: "ARCHIVED" } }, select: { id: true, ownerOrganizationId: true } });
    if (communities.length !== ids.length || communities.some((community) => !canManageCatalogResource(actor, community.ownerOrganizationId))) throw new HttpError(422, "Choose communities in your permitted scope.", "AGENT_COMMUNITY_INVALID");
    await tx.agentCommunity.deleteMany({ where: { agentId } });
    if (ids.length) await tx.agentCommunity.createMany({ data: ids.map((communityId) => ({ agentId, communityId })) });
  }
}

/** Create a staff profile; an optional login link never grants account permissions. */
export async function createAgentProfileCommand(actor: SessionUser, input: AgentCreateCommandInput, ip: string | null) {
  if (!hasGrantedPermission(actor.permissions, "agent:create")) {
    throw new HttpError(403, "You do not have permission to create team profiles.", "FORBIDDEN");
  }
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const jobTitle = input.jobTitle.trim();
  const bio = input.bio?.trim() ?? "";
  const active = input.active ?? Boolean(input.publicTeam || input.publicAdvisor);
  const publicAdvisor = input.publicAdvisor ?? false;
  if (input.publicTeam && !active) throw new HttpError(422, "A published team profile must be active.", "PUBLICATION_VALIDATION");
  if (publicAdvisor && (!active || !bio)) throw new HttpError(422, "A public advisor must be active and have a profile bio.", "PUBLICATION_VALIDATION");
  if (!name || !jobTitle || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) {
    throw new HttpError(422, "Name, job title, and a URL-safe slug are required.", "AGENT_VALIDATION");
  }
  if (input.yearsExperience !== undefined && (!Number.isInteger(input.yearsExperience) || input.yearsExperience < 0 || input.yearsExperience > 80)) {
    throw new HttpError(422, "Years of experience must be between 0 and 80.", "AGENT_VALIDATION");
  }
  validateAdvisorFacts(input);

  try {
    return await db.$transaction(async (tx) => {
      if (!actor.roles.includes("OWNER") && !actor.organizationId) throw new HttpError(403, "A staff organization is required.", "RESOURCE_FORBIDDEN");
      const linkedUser = input.userId ? await tx.user.findFirst({
        where: {
          id: input.userId,
          isActive: true,
          emailVerified: { not: null },
          agent: null,
          roles: { some: { role: { key: "AGENT" } } },
          ...(!actor.roles.includes("OWNER") ? { organizationId: actor.organizationId ?? "__no_organization__" } : {}),
        },
        select: { id: true, organizationId: true },
      }) : null;
      if (input.userId && !linkedUser) {
        throw new HttpError(422, "Choose an active AGENT account in your permitted organization that has no team profile.", "INVALID_AGENT_ACCOUNT");
      }
      const photoMediaId = await requirePublicMedia(tx, input.photoMediaId, ["IMAGE"]);
      const agent = await tx.agent.create({
        data: {
          userId: linkedUser?.id ?? null,
          ownerOrganizationId: linkedUser?.organizationId ?? actor.organizationId,
          publicTeam: input.publicTeam ?? false,
          name,
          slug,
          jobTitle,
          bio,
          department: input.department?.trim() || null,
          yearsExperience: input.yearsExperience ?? 0,
          photoMediaId,
          phoneE164: input.phoneE164 ?? null, whatsappE164: input.whatsappE164 ?? null, email: input.email?.trim().toLowerCase() || null,
          languagesJson: JSON.stringify(input.languages ?? []), specialtiesJson: JSON.stringify(input.specialties ?? []), communitiesJson: JSON.stringify(input.communityIds ?? []),
          active,
          publicAdvisor,
        },
      });
      await replaceAdvisorRelations(tx, actor, agent.id, { languages: input.languages ?? [], specialties: input.specialties ?? [], communityIds: input.communityIds ?? [] });
      const after = {
        userId: linkedUser?.id ?? null, ownerOrganizationId: linkedUser?.organizationId ?? actor.organizationId, publicTeam: input.publicTeam ?? false, name, slug, jobTitle, bio,
        department: input.department?.trim() || null,
        yearsExperience: input.yearsExperience ?? 0,
        photoMediaId, phoneE164: input.phoneE164 ?? null, whatsappE164: input.whatsappE164 ?? null, email: input.email?.trim().toLowerCase() || null,
        languages: input.languages ?? [], specialties: input.specialties ?? [], communityIds: input.communityIds ?? [], active, publicAdvisor,
      };
      await audit({
        actorId: actor.id, organizationId: linkedUser?.organizationId ?? actor.organizationId,
        action: "agent.create", resourceType: "agent", resourceId: agent.id,
        before: null, after, ip,
      }, tx);
      await emitEvent("agent", agent.id, "agent.created", { agentId: agent.id, by: actor.email }, tx);
      return { ok: true as const, agentId: agent.id, updatedAt: agent.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
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
        include: { user: { select: { organizationId: true, emailVerified: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } } },
      });
      if (!agent) throw new HttpError(404, "Team profile not found", "NOT_FOUND");
      if (!canManageAgentProfile(actor, agent.ownerOrganizationId ?? agent.user?.organizationId ?? null)) throw new HttpError(403, "You cannot manage this team profile.", "RESOURCE_FORBIDDEN");
      if (agent.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This team profile changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      }

      const name = input.name?.trim() ?? agent.name;
      const slug = input.slug?.trim().toLowerCase() ?? agent.slug;
      const jobTitle = input.jobTitle?.trim() ?? agent.jobTitle;
      const bio = input.bio?.trim() ?? agent.bio;
      const active = input.active ?? agent.active;
      const publicAdvisor = input.publicAdvisor ?? agent.publicAdvisor;
      const publicTeam = input.publicTeam ?? agent.publicTeam;
      if (publicTeam && !active) throw new HttpError(422, "A published team profile must be active.", "PUBLICATION_VALIDATION");
      if (!name || !jobTitle || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new HttpError(422, "Name, job title, and a URL-safe slug are required.", "AGENT_VALIDATION");
      }
      if (publicAdvisor && (!active || !bio.trim())) {
        throw new HttpError(422, "A public advisor must be active and have a profile bio.", "PUBLICATION_VALIDATION");
      }
      const userId = input.userId === undefined ? agent.userId : input.userId;
      const linkedUser = userId ? await tx.user.findFirst({
        where: { id: userId, isActive: true, emailVerified: { not: null }, roles: { some: { role: { key: "AGENT" } } },
          OR: [{ agent: null }, { agent: { is: { id: agent.id } } }],
          ...(!actor.roles.includes("OWNER") ? { organizationId: agent.ownerOrganizationId ?? actor.organizationId ?? "__no_organization__" } : {}),
        }, select: { id: true, organizationId: true },
      }) : null;
      if (input.userId !== undefined && userId && !linkedUser) throw new HttpError(422, "Choose an active, verified AGENT account in your permitted organization that has no other profile.", "INVALID_AGENT_ACCOUNT");
      if (publicAdvisor && userId && !linkedUser) {
        throw new HttpError(422, "A public advisor must be linked to an active, email-verified AGENT account.", "PUBLICATION_VALIDATION");
      }
      const photoMediaId = input.photoMediaId === undefined
        ? agent.photoMediaId
        : await requirePublicMedia(tx, input.photoMediaId, ["IMAGE"]);
      validateAdvisorFacts({ phoneE164: input.phoneE164 === undefined ? agent.phoneE164 : input.phoneE164, whatsappE164: input.whatsappE164 === undefined ? agent.whatsappE164 : input.whatsappE164, email: input.email === undefined ? agent.email : input.email, languages: input.languages, specialties: input.specialties, communityIds: input.communityIds });

      const before = {
        userId: agent.userId,
        name: agent.name, slug: agent.slug, jobTitle: agent.jobTitle, bio: agent.bio,
        department: agent.department, yearsExperience: agent.yearsExperience, active: agent.active, publicAdvisor: agent.publicAdvisor, publicTeam: agent.publicTeam,
        photoMediaId: agent.photoMediaId, phoneE164: agent.phoneE164, whatsappE164: agent.whatsappE164, email: agent.email,
        languages: input.languages === undefined ? safeArray(agent.languagesJson) : input.languages,
        specialties: input.specialties === undefined ? safeArray(agent.specialtiesJson) : input.specialties,
        communityIds: input.communityIds === undefined ? safeArray(agent.communitiesJson) : input.communityIds,
      };
      const data: Prisma.AgentUncheckedUpdateManyInput = { updatedAt: new Date() };
      if (input.userId !== undefined) data.userId = userId;
      if (input.name !== undefined) data.name = name;
      if (input.slug !== undefined) data.slug = slug;
      if (input.jobTitle !== undefined) data.jobTitle = jobTitle;
      if (input.bio !== undefined) data.bio = bio;
      if (input.department !== undefined) data.department = input.department?.trim() || null;
      if (input.yearsExperience !== undefined) data.yearsExperience = input.yearsExperience;
      if (input.active !== undefined) data.active = active;
      if (input.publicAdvisor !== undefined) data.publicAdvisor = publicAdvisor;
      if (input.publicTeam !== undefined) data.publicTeam = publicTeam;
      if (input.photoMediaId !== undefined) data.photoMediaId = photoMediaId;
      if (input.phoneE164 !== undefined) data.phoneE164 = input.phoneE164?.trim() || null;
      if (input.whatsappE164 !== undefined) data.whatsappE164 = input.whatsappE164?.trim() || null;
      if (input.email !== undefined) data.email = input.email?.trim().toLowerCase() || null;
      if (input.languages !== undefined) data.languagesJson = JSON.stringify(input.languages);
      if (input.specialties !== undefined) data.specialtiesJson = JSON.stringify(input.specialties);
      if (input.communityIds !== undefined) data.communitiesJson = JSON.stringify(input.communityIds);

      const changed = await tx.agent.updateMany({ where: { id: agent.id, updatedAt: expectedUpdatedAt }, data });
      if (changed.count !== 1) throw new HttpError(409, "This team profile changed since it was loaded. Refresh and review the latest values.", "VERSION_CONFLICT");
      await replaceAdvisorRelations(tx, actor, agent.id, input);

      if (slug !== agent.slug) {
        const fromPath = `/agents/${agent.slug}`;
        const toPath = `/agents/${slug}`;
        await tx.redirect.updateMany({ where: { fromPath: toPath, isActive: true }, data: { isActive: false } });
        const redirect = await tx.redirect.findUnique({ where: { fromPath } });
        if (redirect) await tx.redirect.update({ where: { fromPath }, data: { toPath, isActive: true, note: "Team profile slug changed in Admin" } });
        else await tx.redirect.create({ data: { fromPath, toPath, statusCode: 301, note: "Team profile slug changed in Admin" } });
      }

      const after = {
        userId,
        name, slug, jobTitle, bio,
        department: input.department === undefined ? agent.department : input.department?.trim() || null,
        yearsExperience: input.yearsExperience ?? agent.yearsExperience, active, publicAdvisor, publicTeam,
        photoMediaId,
        phoneE164: input.phoneE164 === undefined ? agent.phoneE164 : input.phoneE164?.trim() || null,
        whatsappE164: input.whatsappE164 === undefined ? agent.whatsappE164 : input.whatsappE164?.trim() || null,
        email: input.email === undefined ? agent.email : input.email?.trim().toLowerCase() || null,
        languages: input.languages ?? safeArray(agent.languagesJson), specialties: input.specialties ?? safeArray(agent.specialtiesJson),
        communityIds: input.communityIds ?? safeArray(agent.communitiesJson),
      };
      await audit({ actorId: actor.id, organizationId: actor.organizationId, action: "agent.update", resourceType: "agent", resourceId: agent.id, before, after, ip }, tx);
      await emitEvent("agent", agent.id, "agent.updated", { agentId: agent.id, by: actor.email }, tx);
      const updated = await tx.agent.findUniqueOrThrow({ where: { id: agent.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
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

function safeArray(value: string | null): unknown[] { try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }

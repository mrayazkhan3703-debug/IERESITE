import { createHash, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError, audit, hashPassword, type SessionUser } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";

export const INVITABLE_STAFF_ROLES = ["ADMIN", "MANAGER", "CONTENT_EDITOR", "AGENT", "ANALYST"] as const;
export type InvitableStaffRole = (typeof INVITABLE_STAFF_ROLES)[number];

function assertCanManageOrganization(actor: SessionUser, organizationId: string) {
  if (actor.roles.includes("OWNER")) return;
  if (!actor.roles.includes("ADMIN") || !actor.organizationId || actor.organizationId !== organizationId) {
    throw new HttpError(403, "You cannot manage users outside your organization.", "USER_SCOPE_FORBIDDEN");
  }
}

function assertCanGrantRole(actor: SessionUser, roleKey: string) {
  if (!(INVITABLE_STAFF_ROLES as readonly string[]).includes(roleKey)) {
    throw new HttpError(422, "That role cannot be assigned through staff invitations.", "ROLE_NOT_ASSIGNABLE");
  }
  if (!actor.roles.includes("OWNER") && roleKey === "ADMIN") {
    throw new HttpError(403, "Organization Admins cannot grant the Admin role.", "ROLE_GRANT_FORBIDDEN");
  }
}

export async function createUserInvitationCommand(actor: SessionUser, input: {
  email: string;
  organizationId: string;
  roleKey: InvitableStaffRole;
}, ip: string | null) {
  const email = input.email.trim().toLowerCase();
  assertCanManageOrganization(actor, input.organizationId);
  assertCanGrantRole(actor, input.roleKey);
  const organization = await db.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!organization) throw new HttpError(422, "Choose an existing organization.", "ORGANIZATION_REQUIRED");
  if (await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) {
    throw new HttpError(409, "A user with this email already exists.", "EMAIL_TAKEN");
  }
  const existingInvites = await db.userInvitation.findMany({
    where: { email, acceptedAt: null, revokedAt: null },
    select: { organizationId: true },
  });
  if (!actor.roles.includes("OWNER") && existingInvites.some((invitation) => invitation.organizationId !== input.organizationId)) {
    throw new HttpError(409, "An invitation for this email already exists in another organization. Ask the Owner to manage it.", "INVITATION_EXISTS");
  }
  if (existingInvites.length) throw new HttpError(409, "Revoke the existing pending invitation before sending another.", "INVITATION_EXISTS");

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  let invitation: { id: string; roleKey: string; expiresAt: Date };
  try {
    invitation = await db.$transaction(async (tx) => {
      const created = await tx.userInvitation.create({
        data: { email, organizationId: input.organizationId, roleKey: input.roleKey, invitedBy: actor.id, tokenHash, expiresAt },
      });
      await audit({
        actorId: actor.id, organizationId: input.organizationId, action: "user.invitation.create",
        resourceType: "user_invitation", resourceId: created.id,
        after: { email, roleKey: input.roleKey, organizationId: input.organizationId, expiresAt }, ip,
      }, tx);
      await emitEvent("user-invitation", created.id, "user.invitation.created", { invitationId: created.id, roleKey: input.roleKey }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw new HttpError(409, "An invitation for this email was created concurrently. Refresh and retry.", "INVITATION_EXISTS");
    }
    throw error;
  }

  return { invitationId: invitation.id, email, roleKey: invitation.roleKey, token: rawToken, expiresAt: invitation.expiresAt };
}

export async function revokeUserInvitationCommand(actor: SessionUser, invitationId: string, ip: string | null) {
  return db.$transaction(async (tx) => {
    const invitation = await tx.userInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new HttpError(404, "Invitation not found.", "INVITATION_NOT_FOUND");
    assertCanManageOrganization(actor, invitation.organizationId);
    const now = new Date();
    const updated = await tx.userInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (updated.count !== 1) throw new HttpError(409, "Only an unaccepted, unrevoked invitation can be cleared.", "INVITATION_NOT_PENDING");
    await audit({
      actorId: actor.id, organizationId: invitation.organizationId, action: "user.invitation.revoke",
      resourceType: "user_invitation", resourceId: invitation.id,
      before: { roleKey: invitation.roleKey, status: "PENDING" }, after: { roleKey: invitation.roleKey, status: "REVOKED" }, ip,
    }, tx);
    await emitEvent("user-invitation", invitation.id, "user.updated", { invitationId: invitation.id }, tx);
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateManagedUserCommand(actor: SessionUser, input: {
  userId: string;
  expectedUpdatedAt: string;
  roleKey?: InvitableStaffRole;
  isActive?: boolean;
}, ip: string | null) {
  if (input.userId === actor.id) throw new HttpError(422, "You cannot change your own access here.", "SELF_ACCESS_CHANGE");
  if (input.roleKey === undefined && input.isActive === undefined) throw new HttpError(422, "Choose a role or account status change.", "USER_CHANGE_REQUIRED");
  if (input.roleKey !== undefined) assertCanGrantRole(actor, input.roleKey);

  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, include: { roles: { include: { role: true } } } });
    if (!target) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new HttpError(400, "Invalid user version.", "INVALID_VERSION");
    if (target.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This user changed since it was loaded. Refresh and retry.", "VERSION_CONFLICT");
    if (input.roleKey !== undefined && !target.organizationId) throw new HttpError(422, "Staff roles require an organization assignment.", "ORGANIZATION_REQUIRED");
    assertCanManageOrganization(actor, target.organizationId ?? "");
    const currentRoles = target.roles.map((entry) => entry.role.key);
    if (currentRoles.includes("OWNER")) throw new HttpError(403, "Owner access cannot be changed here.", "ROLE_GRANT_FORBIDDEN");
    if (!actor.roles.includes("OWNER") && currentRoles.includes("ADMIN")) {
      throw new HttpError(403, "Organization Admin access can only be changed by the Owner.", "ROLE_GRANT_FORBIDDEN");
    }
    if (input.roleKey !== undefined && !(await tx.role.findUnique({ where: { key: input.roleKey }, select: { id: true } }))) {
      throw new HttpError(422, "Role configuration is missing.", "ROLE_NOT_CONFIGURED");
    }
    const userUpdate = await tx.user.updateMany({
      where: { id: target.id, updatedAt: expectedUpdatedAt },
      data: { ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), updatedAt: new Date() },
    });
    if (userUpdate.count !== 1) throw new HttpError(409, "This user changed since it was loaded. Refresh and retry.", "VERSION_CONFLICT");
    if (input.roleKey !== undefined) {
      const role = await tx.role.findUniqueOrThrow({ where: { key: input.roleKey }, select: { id: true } });
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.create({ data: { userId: target.id, roleId: role.id, grantedBy: actor.id } });
    }
    if (input.isActive !== undefined) {
      if (!input.isActive) await tx.session.deleteMany({ where: { userId: target.id } });
    }
    // Account reactivation must not silently republish an advisor profile.
    if (input.isActive === false || (input.roleKey !== undefined && input.roleKey !== "AGENT")) {
      await tx.agent.updateMany({ where: { userId: target.id }, data: { active: false, publicAdvisor: false } });
    }
    await audit({
      actorId: actor.id, organizationId: target.organizationId, action: "user.access.update",
      resourceType: "user", resourceId: target.id,
      before: { roles: currentRoles, isActive: target.isActive },
      after: { roles: input.roleKey ? [input.roleKey] : currentRoles, isActive: input.isActive ?? target.isActive }, ip,
    }, tx);
    await emitEvent("user", target.id, "user.updated", { userId: target.id }, tx);
    return { ok: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function acceptUserInvitationCommand(input: {
  token: string;
  password: string;
  name?: string;
}, ip: string | null) {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  return db.$transaction(async (tx) => {
    const invitation = await tx.userInvitation.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) {
      throw new HttpError(400, "This invitation is invalid, expired, or already used.", "INVITATION_INVALID");
    }
    if (await tx.user.findFirst({ where: { email: { equals: invitation.email, mode: "insensitive" } }, select: { id: true } })) {
      throw new HttpError(409, "A user with this email already exists. Contact the inviter.", "EMAIL_TAKEN");
    }
    const claimed = await tx.userInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw new HttpError(400, "This invitation has already been used.", "INVITATION_INVALID");
    const role = await tx.role.findUnique({ where: { key: invitation.roleKey }, select: { id: true } });
    if (!role || !(INVITABLE_STAFF_ROLES as readonly string[]).includes(invitation.roleKey)) {
      throw new HttpError(409, "The invited role is no longer assignable.", "ROLE_NOT_ASSIGNABLE");
    }
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        name: input.name?.trim() || null,
        organizationId: invitation.organizationId,
        emailVerified: now,
        passwordHash: hashPassword(input.password),
        profile: { create: {} },
        roles: { create: { roleId: role.id, grantedBy: invitation.invitedBy } },
      },
      select: { id: true, email: true, organizationId: true },
    });
    await audit({
      actorType: "USER", actorId: user.id, organizationId: invitation.organizationId,
      action: "user.invitation.accept", resourceType: "user", resourceId: user.id,
      after: { roleKey: invitation.roleKey, organizationId: invitation.organizationId, invitationId: invitation.id }, ip,
    }, tx);
    await emitEvent("user", user.id, "user.invitation.accepted", { userId: user.id, invitationId: invitation.id }, tx);
    return { id: user.id, email: user.email };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

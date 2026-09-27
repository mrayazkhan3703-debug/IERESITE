import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { SessionUser } from "@/server/auth";
import {
  acceptUserInvitationCommand,
  createUserInvitationCommand,
  updateManagedUserCommand,
} from "@/server/domain/user-admin-command";

const prefix = `user-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  owner: `${prefix}-owner`,
  admin: `${prefix}-admin`,
  organization: `${prefix}-org`,
  otherOrganization: `${prefix}-other-org`,
};
const owner: SessionUser = {
  sessionId: `${prefix}-owner-session`, id: ids.owner, email: "user-owner@example.invalid", name: "Invitation Owner",
  organizationId: null, roles: ["OWNER"], permissions: ["*"], mfaVerified: true,
};
const admin: SessionUser = {
  sessionId: `${prefix}-admin-session`, id: ids.admin, email: "user-admin@example.invalid", name: "Invitation Admin",
  organizationId: ids.organization, roles: ["ADMIN"], permissions: ["user:read", "user:invite", "user:update"], mfaVerified: true,
};

async function cleanup() {
  const legacyUsers = await db.user.findMany({
    where: { email: { in: ["user-owner@example.invalid", "user-admin@example.invalid", "new-manager@example.invalid", "managed-agent@example.invalid"] } },
    select: { id: true, organizationId: true },
  });
  const userIds = [...new Set([ids.owner, ids.admin, ...legacyUsers.map((user) => user.id), ...await db.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } }).then((users) => users.map((user) => user.id))])];
  const organizationIds = [...new Set([ids.organization, ids.otherOrganization, ...legacyUsers.map((user) => user.organizationId).filter((id): id is string => Boolean(id))])];
  const invitations = await db.userInvitation.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
  const invitationIds = invitations.map((invitation) => invitation.id);
  await db.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: organizationIds } }, { resourceId: { in: [...userIds, ...invitationIds] } }] } });
  await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...userIds, ...invitationIds] } } });
  await db.userInvitation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
}

beforeAll(async () => {
  await cleanup();
  await db.organization.createMany({ data: [
    { id: ids.organization, name: "Invitation Test Organization", slug: `${prefix}-org` },
    { id: ids.otherOrganization, name: "Invitation Other Organization", slug: `${prefix}-other` },
  ] });
  await db.user.create({ data: { id: ids.owner, email: owner.email } });
  await db.user.create({
    data: { id: ids.admin, email: admin.email, organizationId: ids.organization, roles: { create: { role: { connect: { key: "ADMIN" } } } } },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("staff invitation and access commands", () => {
  test("Admin is restricted to lower-privilege roles in its own organization", async () => {
    await expect(createUserInvitationCommand(admin, {
      email: "higher@example.invalid", organizationId: ids.organization, roleKey: "ADMIN",
    }, null)).rejects.toMatchObject({ status: 403, code: "ROLE_GRANT_FORBIDDEN" });
    await expect(createUserInvitationCommand(admin, {
      email: "outside@example.invalid", organizationId: ids.otherOrganization, roleKey: "MANAGER",
    }, null)).rejects.toMatchObject({ status: 403, code: "USER_SCOPE_FORBIDDEN" });
  });

  test("single-use invitation creates a verified organization-bound account and role", async () => {
    const invitation = await createUserInvitationCommand(owner, {
      email: `${prefix}-manager@example.invalid`, organizationId: ids.organization, roleKey: "MANAGER",
    }, "127.0.0.1");
    await expect(createUserInvitationCommand(owner, {
      email: `${prefix}-manager@example.invalid`, organizationId: ids.organization, roleKey: "AGENT",
    }, null)).rejects.toMatchObject({ status: 409, code: "INVITATION_EXISTS" });
    const stored = await db.userInvitation.findUniqueOrThrow({ where: { id: invitation.invitationId } });
    expect(stored.tokenHash).not.toBe(invitation.token);
    expect(stored.email).toBe(`${prefix}-manager@example.invalid`);
    const accepted = await acceptUserInvitationCommand({ token: invitation.token, password: "StrongPassword123!", name: "New Manager" }, "127.0.0.1");
    const user = await db.user.findUniqueOrThrow({ where: { id: accepted.id }, include: { roles: { include: { role: true } } } });
    expect(user.emailVerified).not.toBeNull();
    expect(user.organizationId).toBe(ids.organization);
    expect(user.passwordHash).not.toContain("StrongPassword123!");
    expect(user.roles.map((entry) => entry.role.key)).toEqual(["MANAGER"]);
    expect((await db.userInvitation.findUniqueOrThrow({ where: { id: invitation.invitationId } })).acceptedAt).not.toBeNull();
    await expect(acceptUserInvitationCommand({ token: invitation.token, password: "StrongPassword123!" }, null)).rejects.toMatchObject({ status: 400, code: "INVITATION_INVALID" });
  });

  test("Admin can suspend a lower-tier account and suspension revokes sessions", async () => {
    const invitation = await createUserInvitationCommand(owner, {
      email: `${prefix}-agent@example.invalid`, organizationId: ids.organization, roleKey: "AGENT",
    }, null);
    const accepted = await acceptUserInvitationCommand({ token: invitation.token, password: "StrongPassword123!" }, null);
    const acceptedUser = await db.user.findUniqueOrThrow({ where: { id: accepted.id } });
    await db.session.create({ data: {
      userId: accepted.id, tokenHash: `${prefix}-session-hash`, expiresAt: new Date(Date.now() + 60_000),
    } });
    await updateManagedUserCommand(admin, { userId: accepted.id, expectedUpdatedAt: acceptedUser.updatedAt.toISOString(), isActive: false }, null);
    const user = await db.user.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(user.isActive).toBe(false);
    expect(await db.session.count({ where: { userId: accepted.id } })).toBe(0);
    await expect(updateManagedUserCommand(admin, { userId: accepted.id, expectedUpdatedAt: user.updatedAt.toISOString(), roleKey: "ADMIN" }, null)).rejects.toMatchObject({ status: 403, code: "ROLE_GRANT_FORBIDDEN" });
  });
});

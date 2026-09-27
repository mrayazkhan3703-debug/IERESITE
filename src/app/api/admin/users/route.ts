import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { sendStaffInvitationEmail } from "@/server/account-email";
import {
  createUserInvitationCommand,
  INVITABLE_STAFF_ROLES,
  revokeUserInvitationCommand,
  updateManagedUserCommand,
} from "@/server/domain/user-admin-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const actor = await requirePermission("user:read");
  const isOwner = actor.roles.includes("OWNER");
  const organizationScope = isOwner ? {} : { organizationId: actor.organizationId ?? "__no_organization__" };
  const [users, invitations, organizations] = await Promise.all([
    db.user.findMany({
      where: organizationScope,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, email: true, name: true, organizationId: true, isActive: true,
        emailVerified: true, createdAt: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
        organization: { select: { name: true } },
      },
    }),
    db.userInvitation.findMany({
      where: { ...organizationScope, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, email: true, roleKey: true, organizationId: true, createdAt: true, expiresAt: true, revokedAt: true,
        organization: { select: { name: true } },
      },
    }),
    isOwner
      ? db.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : actor.organizationId
        ? db.organization.findMany({ where: { id: actor.organizationId }, select: { id: true, name: true } })
        : Promise.resolve([]),
  ]);
  const roleOptions = isOwner ? INVITABLE_STAFF_ROLES : INVITABLE_STAFF_ROLES.filter((role) => role !== "ADMIN");
  return NextResponse.json({
    users: users.map((user) => ({ ...user, emailVerified: user.emailVerified !== null })),
    invitations: invitations.map((invitation) => ({
      ...invitation,
      status: invitation.revokedAt ? "REVOKED" : invitation.expiresAt <= new Date() ? "EXPIRED" : "PENDING",
    })),
    organizations,
    roleOptions,
  });
});

const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  organizationId: z.string().min(1),
  roleKey: z.enum(INVITABLE_STAFF_ROLES),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("user:invite");
  const input = inviteSchema.parse(await jsonBody<z.infer<typeof inviteSchema>>(req));
  const invitation = await createUserInvitationCommand(actor, input, clientIp(req));
  const delivery = await sendStaffInvitationEmail(invitation.email, invitation.token, invitation.roleKey).catch(() => ({ accepted: false, provider: "unavailable", messageId: null }));
  return NextResponse.json({
    invitation: { id: invitation.invitationId, email: invitation.email, roleKey: invitation.roleKey, expiresAt: invitation.expiresAt.toISOString() },
    emailDelivery: delivery.accepted ? "accepted" : "not_configured_or_failed",
  }, { status: 201 });
});

const accessSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke-invitation"), invitationId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("update-user"), userId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), roleKey: z.enum(INVITABLE_STAFF_ROLES).optional(), isActive: z.boolean().optional() }).strict(),
]);

export const PATCH = apiHandler(async (req) => {
  const input = accessSchema.parse(await jsonBody<z.infer<typeof accessSchema>>(req));
  const ip = clientIp(req);
  if (input.action === "revoke-invitation") {
    const actor = await requirePermission("user:invite");
    return NextResponse.json(await revokeUserInvitationCommand(actor, input.invitationId, ip));
  }
  const actor = await requirePermission("user:update");
  const { action: _action, ...command } = input;
  return NextResponse.json(await updateManagedUserCommand(actor, command, ip));
});

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { hasGrantedPermission } from "@/server/authz-policy";
import { scopedLeadWhere } from "@/server/domain/resource-policy";
import { emitEvent } from "@/server/jobs/outbox";

export interface LeadAdminUpdateInput {
  leadId: string;
  expectedUpdatedAt: string;
  status?: "NEW" | "ATTEMPTED" | "CONTACTED" | "QUALIFIED" | "NURTURE" | "WON" | "LOST" | "SPAM";
  ownerAgentId?: string | null;
  note?: string;
}

function parseVersion(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid lead version.", "INVALID_VERSION");
  return parsed;
}

export async function updateLeadAdminCommand(actor: SessionUser, input: LeadAdminUpdateInput, ip: string | null) {
  if (input.ownerAgentId !== undefined && !hasGrantedPermission(actor.permissions, "lead:assign")) {
    throw new HttpError(403, "You do not have permission to assign leads.", "FORBIDDEN");
  }
  if (input.status === undefined && input.ownerAgentId === undefined && !input.note?.trim()) {
    throw new HttpError(422, "Choose a lead update or add a note.", "LEAD_UPDATE_EMPTY");
  }
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);

  try {
    return await db.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: scopedLeadWhere(actor, { id: input.leadId }) });
      if (!lead) throw new HttpError(404, "Lead not found.", "NOT_FOUND");
      if (lead.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new HttpError(409, "This lead changed since it was loaded. Refresh before saving.", "VERSION_CONFLICT");

      if (input.ownerAgentId) {
        const target = await tx.agent.findFirst({
          where: {
            id: input.ownerAgentId,
            active: true,
            ...(!actor.roles.includes("OWNER")
              ? { user: { is: { organizationId: actor.organizationId ?? "__no_organization__" } } }
              : {}),
          },
          select: { id: true },
        });
        if (!target) throw new HttpError(400, "Assignment target is outside your organization or inactive.", "INVALID_ASSIGNEE");
      }

      const nextStatus = input.status ?? lead.status;
      const nextOwnerAgentId = input.ownerAgentId !== undefined ? input.ownerAgentId : lead.ownerAgentId;
      const before = { status: lead.status, ownerAgentId: lead.ownerAgentId, assignedAt: lead.assignedAt?.toISOString() ?? null };
      const changed = await tx.lead.updateMany({
        where: { ...scopedLeadWhere(actor, { id: lead.id }), updatedAt: expectedUpdatedAt },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.ownerAgentId !== undefined ? { ownerAgentId: input.ownerAgentId, assignedAt: input.ownerAgentId ? new Date() : null } : {}),
          updatedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new HttpError(409, "This lead changed during save. Refresh and retry.", "VERSION_CONFLICT");

      if (input.ownerAgentId !== undefined && input.ownerAgentId !== lead.ownerAgentId) {
        await tx.leadAssignment.updateMany({ where: { leadId: lead.id, active: true }, data: { active: false } });
        if (input.ownerAgentId) {
          await tx.leadAssignment.create({ data: { leadId: lead.id, agentId: input.ownerAgentId, assignedBy: actor.id, reason: "MANUAL", active: true } });
        }
      }

      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          eventType: input.status ? "STATUS_CHANGED" : input.ownerAgentId !== undefined ? "ASSIGNED" : "NOTE",
          payloadJson: JSON.stringify({
            ...(input.status ? { to: input.status } : {}),
            ...(input.ownerAgentId !== undefined ? { ownerAgentId: input.ownerAgentId } : {}),
            ...(input.note?.trim() ? { note: input.note.trim() } : {}),
            by: actor.email,
          }),
          actorType: "USER",
          actorId: actor.id,
        },
      });
      await audit({
        actorType: "USER", actorId: actor.id, organizationId: lead.organizationId,
        action: "lead.update", resourceType: "lead", resourceId: lead.id,
        before, after: { status: nextStatus, ownerAgentId: nextOwnerAgentId }, ip,
      }, tx);
      const ownerChanged = input.ownerAgentId !== undefined && input.ownerAgentId !== lead.ownerAgentId;
      const statusChanged = input.status !== undefined && input.status !== lead.status;
      if (ownerChanged) await emitEvent("lead", lead.id, "lead.assignment_changed", { leadId: lead.id }, tx);
      if (statusChanged) await emitEvent("lead", lead.id, "lead.status_changed", { leadId: lead.id }, tx);
      if (!ownerChanged && !statusChanged) await emitEvent("lead", lead.id, "lead.updated", { leadId: lead.id }, tx);
      const updated = await tx.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { updatedAt: true } });
      return { ok: true as const, updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This lead changed during save. Refresh and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

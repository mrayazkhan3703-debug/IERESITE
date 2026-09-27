import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { preferredBookingTimeSchema, submitLead, type LeadSubmitInput } from "@/server/domain/lead-service";
import { confirmBookingAdminCommand } from "@/server/domain/booking-admin-command";
import { updateLeadAdminCommand } from "@/server/domain/lead-admin-command";
import { mapOutboxEventToJob } from "@/server/jobs/outbox";
import type { SessionUser } from "@/server/auth";
import { createHash } from "node:crypto";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtureEmails = [
  `consultation-idempotent-${suffix}@example.invalid`,
  `consultation-soft-duplicate-${suffix}@example.invalid`,
  `consultation-late-request-${suffix}@example.invalid`,
  `consultation-confirm-${suffix}@example.invalid`,
  `consultation-assignment-${suffix}@example.invalid`,
];
const leadIds: string[] = [];
const bookingIds: string[] = [];
const actorUserIds: string[] = [];
const agentIds: string[] = [];
const fixtureOrganizationId = `consultation-request-org-${suffix}`;
let ownsFixtureOrganization = false;
let attributionSessionId: string | null = null;

function input(email: string, extra: Partial<LeadSubmitInput> = {}): LeadSubmitInput {
  return {
    intent: "CONSULT",
    name: "Synthetic Consultation Test",
    email,
    phone: "+971500000001",
    consentContact: true,
    consentMarketing: false,
    preferredLocale: "en",
    sourceChannel: "WEBSITE",
    ...extra,
  };
}

function futureTime(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60_000).toISOString();
}

beforeAll(async () => {
  const existingDefault = await db.organization.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!existingDefault) {
    await db.organization.create({
      data: {
        id: fixtureOrganizationId,
        name: "Synthetic consultation test organization",
        slug: fixtureOrganizationId,
        isDefault: true,
      },
    });
    ownsFixtureOrganization = true;
  }
  const session = await db.websiteSession.create({ data: { sessionKey: createHash("sha256").update(suffix).digest("hex") } });
  attributionSessionId = session.id;
});

afterAll(async () => {
  const ids = [...new Set(leadIds)];
  const outbox = ids.length
    ? await db.outboxEvent.findMany({ where: { aggregateType: "lead", aggregateId: { in: ids } }, select: { id: true } })
    : [];
  const crmJobKeys = outbox.map((event) => `outbox:${event.id}:crm.lead.deliver`);
  if (crmJobKeys.length) await db.jobRun.deleteMany({ where: { idempotencyKey: { in: crmJobKeys } } });
  if (attributionSessionId) await db.attributionTouchpoint.deleteMany({ where: { sessionId: attributionSessionId } });
  if (bookingIds.length) await db.auditLog.deleteMany({ where: { resourceType: "booking", resourceId: { in: bookingIds } } });
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { resourceType: "lead", resourceId: { in: ids } } });
    await db.crmSyncRecord.deleteMany({ where: { leadId: { in: ids } } });
    await db.booking.deleteMany({ where: { leadId: { in: ids } } });
    await db.viewing.deleteMany({ where: { leadId: { in: ids } } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: "lead", aggregateId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  if (attributionSessionId) await db.websiteSession.deleteMany({ where: { id: attributionSessionId } });
  await db.contact.deleteMany({ where: { email: { in: fixtureEmails } } });
  if (ownsFixtureOrganization) await db.organization.deleteMany({ where: { id: fixtureOrganizationId } });
  if (actorUserIds.length) await db.user.deleteMany({ where: { id: { in: actorUserIds } } });
  if (agentIds.length) await db.agent.deleteMany({ where: { id: { in: agentIds } } });
  await db.$disconnect();
});

describe("consultation request persistence", () => {
  test("preferred times must be future dates within the 30-day request window", () => {
    expect(preferredBookingTimeSchema.safeParse(futureTime(2)).success).toBe(true);
    expect(preferredBookingTimeSchema.safeParse(new Date(Date.now() - 60_000).toISOString()).success).toBe(false);
    expect(preferredBookingTimeSchema.safeParse(futureTime(31)).success).toBe(false);
  });

  test("creates a REQUESTED preference and returns the same request for an idempotent retry", async () => {
    const clientSubmissionId = `consultation-${suffix}`;
    const preferredAt = futureTime(4);
    const first = await submitLead(input(fixtureEmails[0], {
      clientSubmissionId,
      scheduledAt: preferredAt,
      bookingType: "CONSULTATION",
      channel: "VIDEO",
      sessionId: "browser-supplied-session-id",
      pagePath: "/consultation?email=private@example.invalid",
      landingUrl: "/campaign/launch?email=private@example.invalid",
      referrer: "https://source.example.invalid/landing?email=private@example.invalid",
      utmSource: "private@example.invalid",
    }), { attributionSessionId });
    leadIds.push(first.leadId);

    expect(first.duplicate).toBe(false);
    expect(first.booking?.status).toBe("REQUESTED");
    expect(first.booking?.created).toBe(true);
    const leadContext = await db.leadContext.findUniqueOrThrow({ where: { leadId: first.leadId } });
    expect(leadContext.sessionId).toBe(attributionSessionId);
    expect({ landingUrl: leadContext.landingUrl, referrer: leadContext.referrer, pagePath: leadContext.pagePath, utmSource: leadContext.utmSource }).toEqual({
      landingUrl: "/campaign/launch",
      referrer: "https://source.example.invalid/landing",
      pagePath: "/consultation",
      utmSource: null,
    });
    const formTouchpoints = await db.attributionTouchpoint.findMany({ where: { leadId: first.leadId } });
    expect(formTouchpoints).toHaveLength(1);
    expect(formTouchpoints[0]).toMatchObject({ sessionId: attributionSessionId, touchType: "FORM_SUBMIT", path: "/consultation" });

    const retry = await submitLead(input(fixtureEmails[0], {
      clientSubmissionId,
      scheduledAt: futureTime(5),
      bookingType: "CONSULTATION",
      channel: "VIDEO",
    }));
    const stored = await db.booking.findUniqueOrThrow({ where: { leadId: first.leadId } });

    expect(retry.leadId).toBe(first.leadId);
    expect(retry.duplicate).toBe(true);
    expect(retry.booking?.reference).toBe(first.booking?.reference);
    expect(retry.booking?.status).toBe("REQUESTED");
    expect(retry.booking?.created).toBe(false);
    expect(stored.scheduledAt.toISOString()).toBe(preferredAt);
    expect(await db.leadEvent.count({ where: { leadId: first.leadId, eventType: "BOOKING_REQUESTED" } })).toBe(1);
  });

  test("soft duplicates reuse the existing preference without overwriting its time", async () => {
    const preferredAt = futureTime(6);
    const first = await submitLead(input(fixtureEmails[1], {
      scheduledAt: preferredAt,
      bookingType: "CONSULTATION",
      channel: "OFFICE",
    }));
    leadIds.push(first.leadId);
    const duplicate = await submitLead(input(fixtureEmails[1], {
      scheduledAt: futureTime(7),
      bookingType: "CONSULTATION",
      channel: "OFFICE",
    }));

    expect(duplicate.leadId).toBe(first.leadId);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.booking?.reference).toBe(first.booking?.reference);
    expect(duplicate.booking?.created).toBe(false);
    expect((await db.booking.findUniqueOrThrow({ where: { leadId: first.leadId } })).scheduledAt.toISOString()).toBe(preferredAt);
    expect(await db.leadEvent.count({ where: { leadId: first.leadId, eventType: "BOOKING_REQUESTED" } })).toBe(1);
  });

  test("a repeat enquiry can add a pending request to a lead without a booking", async () => {
    const first = await submitLead(input(fixtureEmails[2]));
    leadIds.push(first.leadId);
    expect(first.booking).toBeUndefined();

    const followup = await submitLead(input(fixtureEmails[2], {
      scheduledAt: futureTime(8),
      bookingType: "CONSULTATION",
      channel: "PHONE",
    }));
    const stored = await db.booking.findUniqueOrThrow({ where: { leadId: first.leadId } });

    expect(followup.leadId).toBe(first.leadId);
    expect(followup.duplicate).toBe(true);
    expect(followup.booking?.created).toBe(true);
    expect(followup.booking?.status).toBe("REQUESTED");
    expect(stored.status).toBe("REQUESTED");
  });

  test("confirmation requires evidence and records a one-time human-attested status transition", async () => {
    const created = await submitLead(input(fixtureEmails[3], {
      scheduledAt: futureTime(9), bookingType: "CONSULTATION", channel: "PHONE",
    }));
    leadIds.push(created.leadId);
    const booking = await db.booking.findUniqueOrThrow({ where: { leadId: created.leadId } });
    bookingIds.push(booking.id);
    const actorUser = await db.user.create({ data: { email: `consultation-owner-${suffix}@example.invalid`, name: "Synthetic owner" } });
    actorUserIds.push(actorUser.id);
    const actor: SessionUser = {
      id: actorUser.id, sessionId: `synthetic-session-${suffix}`, email: actorUser.email,
      name: "Synthetic owner", organizationId: null, roles: ["OWNER"], permissions: ["*"], mfaVerified: true,
    };
    const confirmationInput = {
      bookingId: booking.id,
      expectedUpdatedAt: booking.updatedAt.toISOString(),
      evidenceSource: "CUSTOMER_CONFIRMATION" as const,
      evidenceNote: "Customer confirmed the preferred appointment time by phone.",
    };

    await expect(confirmBookingAdminCommand(actor, { ...confirmationInput, evidenceNote: "too short" }, null))
      .rejects.toThrow("Add a brief confirmation evidence note");
    const result = await confirmBookingAdminCommand(actor, confirmationInput, null);
    expect(result.status).toBe("CONFIRMED");
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
    const event = await db.leadEvent.findFirstOrThrow({ where: { leadId: created.leadId, eventType: "BOOKING_HUMAN_CONFIRMED" } });
    expect(JSON.parse(event.payloadJson ?? "{}")).toMatchObject({ evidenceSource: "CUSTOMER_CONFIRMATION", evidenceNote: confirmationInput.evidenceNote });
    expect(await db.auditLog.count({ where: { resourceType: "booking", resourceId: booking.id, action: "booking.human_confirmed" } })).toBe(1);
    await expect(confirmBookingAdminCommand(actor, { ...confirmationInput, expectedUpdatedAt: result.updatedAt }, null))
      .rejects.toThrow("Only a pending consultation request can be confirmed");
  });

  test("Admin lead owner and status changes emit dedicated idempotent CRM jobs", async () => {
    const created = await submitLead(input(fixtureEmails[4], { clientSubmissionId: `assignment-${suffix}` }));
    leadIds.push(created.leadId);
    const actorUser = await db.user.create({ data: { email: `assignment-owner-${suffix}@example.invalid`, name: "Synthetic owner" } });
    actorUserIds.push(actorUser.id);
    const actor: SessionUser = {
      id: actorUser.id, sessionId: `assignment-session-${suffix}`, email: actorUser.email,
      name: "Synthetic owner", organizationId: null, roles: ["OWNER"], permissions: ["*"], mfaVerified: true,
    };
    const agent = await db.agent.create({ data: { name: "Synthetic assignment agent", slug: `synthetic-assignment-${suffix}` } });
    agentIds.push(agent.id);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: created.leadId }, select: { updatedAt: true } });

    await updateLeadAdminCommand(actor, {
      leadId: created.leadId,
      expectedUpdatedAt: lead.updatedAt.toISOString(),
      ownerAgentId: agent.id,
      status: "QUALIFIED",
    }, null);
    const assignmentEvent = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateType: "lead", aggregateId: created.leadId, eventType: "lead.assignment_changed" },
    });
    expect(mapOutboxEventToJob(assignmentEvent.id, assignmentEvent.eventType, assignmentEvent.aggregateType, assignmentEvent.aggregateId, {})).toEqual({
      key: "crm.lead.assignment.sync",
      payload: { leadId: created.leadId },
      idempotencyKey: `outbox:${assignmentEvent.id}:crm.lead.assignment.sync`,
    });
    const statusEvent = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateType: "lead", aggregateId: created.leadId, eventType: "lead.status_changed" },
    });
    expect(mapOutboxEventToJob(statusEvent.id, statusEvent.eventType, statusEvent.aggregateType, statusEvent.aggregateId, {})).toEqual({
      key: "crm.lead.status.sync",
      payload: { leadId: created.leadId },
      idempotencyKey: `outbox:${statusEvent.id}:crm.lead.status.sync`,
    });
  });
});

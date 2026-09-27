import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, HttpError, type SessionUser } from "@/server/auth";
import { scopedLeadWhere } from "@/server/domain/resource-policy";

export type BookingConfirmationSource = "CUSTOMER_CONFIRMATION" | "AGENT_CONFIRMATION" | "PROVIDER_RECORD_REVIEWED";

export interface ConfirmBookingAdminInput {
  bookingId: string;
  expectedUpdatedAt: string;
  evidenceSource: BookingConfirmationSource;
  evidenceNote: string;
}

function parseVersion(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, "Invalid booking version.", "INVALID_VERSION");
  return parsed;
}

/** Record an operator-attested confirmation; this intentionally performs no calendar/GHL calls. */
export async function confirmBookingAdminCommand(actor: SessionUser, input: ConfirmBookingAdminInput, ip: string | null) {
  const evidenceNote = input.evidenceNote.trim();
  if (evidenceNote.length < 10 || evidenceNote.length > 1000) {
    throw new HttpError(422, "Add a brief confirmation evidence note (10–1000 characters).", "BOOKING_EVIDENCE_REQUIRED");
  }
  const expectedUpdatedAt = parseVersion(input.expectedUpdatedAt);

  try {
    return await db.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: input.bookingId, lead: { is: scopedLeadWhere(actor) } },
        include: { lead: { select: { id: true, organizationId: true } } },
      });
      if (!booking) throw new HttpError(404, "Booking request not found.", "NOT_FOUND");
      if (booking.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new HttpError(409, "This booking changed since it was loaded. Refresh before confirming.", "VERSION_CONFLICT");
      }
      if (booking.status !== "REQUESTED") {
        throw new HttpError(409, "Only a pending consultation request can be confirmed.", "BOOKING_NOT_PENDING");
      }

      const updatedAt = new Date();
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, status: "REQUESTED", updatedAt: expectedUpdatedAt },
        data: { status: "CONFIRMED", updatedAt },
      });
      if (changed.count !== 1) throw new HttpError(409, "This booking changed during save. Refresh and retry.", "VERSION_CONFLICT");

      await tx.leadEvent.create({
        data: {
          leadId: booking.lead.id,
          eventType: "BOOKING_HUMAN_CONFIRMED",
          payloadJson: JSON.stringify({ bookingReference: booking.reference, evidenceSource: input.evidenceSource, evidenceNote }),
          actorType: "USER",
          actorId: actor.id,
        },
      });
      await audit({
        actorId: actor.id,
        organizationId: booking.lead.organizationId,
        action: "booking.human_confirmed",
        resourceType: "booking",
        resourceId: booking.id,
        before: { status: booking.status },
        after: { status: "CONFIRMED", evidenceSource: input.evidenceSource, evidenceNote },
        ip,
      }, tx);

      return { ok: true as const, bookingId: booking.id, status: "CONFIRMED" as const, updatedAt: updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "This booking changed during save. Refresh and retry.", "VERSION_CONFLICT");
    }
    throw error;
  }
}

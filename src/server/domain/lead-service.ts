/**
 * Lead service (Q15, blueprint C012–C018 + lead flows): server-side validation,
 * contact matching/dedupe, attribution capture, consent recording, deterministic
 * scoring, assignment, transactional-outbox CRM handoff. A CRM outage never
 * loses a lead (F09).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { emitEvent } from "@/server/jobs/outbox";
import { logEvent } from "@/server/rate-limit";
import { safeAttributionPath, safeAttributionReferrer, safeAttributionUtm } from "@/server/privacy/analytics-attribution";

export const preferredBookingTimeSchema = z.string().datetime().refine((value) => {
  const timestamp = Date.parse(value);
  const now = Date.now();
  return timestamp > now && timestamp <= now + 30 * 24 * 60 * 60_000;
}, "Choose a preferred time within the next 30 days.");

export const leadSubmitSchema = z.object({
  intent: z.enum(["BUY", "RENT", "INVEST", "SELL", "LIST", "VALUATION", "CONSULT", "GENERAL"]).default("BUY"),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200).optional(),
  phone: z.string().min(7).max(30).optional(),
  message: z.string().max(2000).optional(),
  entityType: z.enum(["PROPERTY", "PROJECT", "COMMUNITY", "DEVELOPER", "AGENT", "MARKET_REPORT", "GUIDE", "PAGE"]).optional(),
  entityId: z.string().max(64).optional(),
  entitySlug: z.string().max(200).optional(),
  entityTitle: z.string().max(300).optional(),
  consentContact: z.literal(true),
  consentMarketing: z.boolean().default(false),
  preferredLocale: z.string().max(5).default("en"),
  sourceChannel: z.enum(["WEBSITE", "WHATSAPP", "PHONE", "AI_ADVISOR", "REFERRAL", "CAMPAIGN"]).default("WEBSITE"),
  scheduledAt: preferredBookingTimeSchema.optional(),
  bookingType: z.enum(["CONSULTATION", "VIEWING", "CALLBACK"]).optional(),
  channel: z.enum(["OFFICE", "VIDEO", "PHONE", "WHATSAPP"]).optional(),
  topic: z.string().max(200).optional(),
  budgetMin: z.number().int().min(0).max(500_000_000).optional(),
  budgetMax: z.number().int().min(0).max(500_000_000).optional(),
  agentSlug: z.string().max(200).optional(),
  searchState: z.record(z.string(), z.unknown()).optional(),
  landingUrl: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  sessionId: z.string().max(64).optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP"]).optional(),
  pagePath: z.string().max(300).optional(),
  aiConversationId: z.string().max(64).optional(),
  /** idempotency: same client submission id resubmits resolve to the same lead */
  clientSubmissionId: z.string().max(64).optional(),
  /* U16 (§26) additive: structured property details from the multi-step
   * list-property funnel (location/building/type/beds/size/status/media counts).
   * Free-form record; server clamps the serialized size. */
  propertyDetails: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => v.email || v.phone, { message: "Email or phone is required", path: ["email"] });

export type LeadSubmitInput = z.infer<typeof leadSubmitSchema>;

export interface LeadSubmitResultApi {
  leadId: string;
  reference: string;
  status: string;
  duplicate: boolean;
  booking?: {
    reference: string;
    status: string;
    scheduledAt: string;
    created: boolean;
  };
}

export interface LeadSubmitOptions {
  /** Server-resolved WebsiteSession ID; never accept this from a browser payload. */
  attributionSessionId?: string | null;
}

type BookingRowSummary = { reference: string; status: string; scheduledAt: Date };

function bookingResult(booking: BookingRowSummary | null, created: boolean) {
  return booking ? {
    reference: booking.reference,
    status: booking.status,
    scheduledAt: booking.scheduledAt.toISOString(),
    created,
  } : undefined;
}

async function createRequestedBooking(
  tx: Prisma.TransactionClient,
  leadId: string,
  agentId: string | null,
  input: LeadSubmitInput,
) {
  if (!input.scheduledAt || !input.bookingType) return undefined;
  const reference = `IE-${leadId.slice(-6).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const booking = await tx.booking.create({
    data: {
      leadId,
      bookingType: input.bookingType,
      agentId,
      scheduledAt: new Date(input.scheduledAt),
      channel: input.channel ?? "OFFICE",
      topic: input.topic ?? input.entityTitle ?? null,
      status: "REQUESTED",
      reference,
    },
    select: { reference: true, status: true, scheduledAt: true },
  });
  await tx.leadEvent.create({
    data: {
      leadId,
      eventType: "BOOKING_REQUESTED",
      payloadJson: JSON.stringify({ reference, bookingType: input.bookingType, scheduledAt: input.scheduledAt }),
      actorType: "USER",
    },
  });
  return bookingResult(booking, true);
}

function normalizeEmail(email?: string): string | undefined {
  return email?.trim().toLowerCase();
}

/** Deterministic, size-clamped JSON for the additive propertyDetails column. */
function safeJsonStringify(value: Record<string, unknown>): string | null {
  try {
    const s = JSON.stringify(value, (k, v) => {
      if (typeof v === "bigint") return v.toString();
      return v;
    });
    return s && s.length <= 6000 ? s : null;
  } catch {
    return null;
  }
}

/** E.164-ish normalization for Gulf-centric inputs */
export function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, "");
  let p = digits.startsWith("+") ? digits : digits.replace(/^00/, "+");
  if (!p.startsWith("+")) {
    if (p.startsWith("0")) p = `+971${p.slice(1)}`; // local UAE format
    else if (p.length >= 9) p = `+${p}`;
  }
  return p;
}

function dedupeKeyFor(email?: string, phone?: string): string {
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return `anon:${randomBytes(12).toString("hex")}`;
}

/** Deterministic lead score (qualification support — AS-11) */
export function scoreLead(input: LeadSubmitInput, entityContext: { hasEntity: boolean; isExclusive: boolean }): { score: number; band: string; reasons: { factor: string; weight: number }[] } {
  let score = 30;
  const reasons: { factor: string; weight: number }[] = [];
  if (input.email && input.phone) { score += 15; reasons.push({ factor: "both_contact_channels", weight: 15 }); }
  else if (input.email || input.phone) { score += 8; reasons.push({ factor: "single_contact_channel", weight: 8 }); }
  if (input.message && input.message.length > 40) { score += 12; reasons.push({ factor: "detailed_message", weight: 12 }); }
  if (entityContext.hasEntity) { score += 20; reasons.push({ factor: "entity_attached", weight: 20 }); }
  if (entityContext.isExclusive) { score += 10; reasons.push({ factor: "exclusive_listing", weight: 10 }); }
  if (input.budgetMax && input.budgetMax > 0) { score += 10; reasons.push({ factor: "budget_declared", weight: 10 }); }
  if (input.intent === "INVEST" || input.intent === "BUY") { score += 8; reasons.push({ factor: `intent_${input.intent.toLowerCase()}`, weight: 8 }); }
  if (input.scheduledAt) { score += 15; reasons.push({ factor: "booking_requested", weight: 15 }); }
  if (input.sourceChannel === "AI_ADVISOR") { score += 5; reasons.push({ factor: "ai_qualification", weight: 5 }); }
  const band = score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";
  return { score, band, reasons };
}

export async function submitLead(input: LeadSubmitInput, options: LeadSubmitOptions = {}): Promise<LeadSubmitResultApi> {
  return db.$transaction((tx) => submitLeadTransaction(tx, input, options));
}

async function recordFormTouchpoint(tx: Prisma.TransactionClient, sessionId: string | null | undefined, leadId: string, path?: string | null) {
  if (!sessionId) return;
  await tx.attributionTouchpoint.create({
    data: {
      sessionId,
      leadId,
      touchType: "FORM_SUBMIT",
      path: safeAttributionPath(path),
    },
  });
}

async function submitLeadTransaction(
  tx: Prisma.TransactionClient,
  input: LeadSubmitInput,
  options: LeadSubmitOptions,
): Promise<LeadSubmitResultApi> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const dedupeKey = dedupeKeyFor(email, phone);
  const organization = await tx.organization.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!organization) {
    throw new Error("No default organization is configured for lead intake");
  }

  // Idempotency: client submission id
  if (input.clientSubmissionId) {
    const existing = await tx.lead.findFirst({
      where: { organizationId: organization.id, dedupeKey: `form:${input.clientSubmissionId}` },
    });
    if (existing) {
      const existingBooking = await tx.booking.findUnique({ where: { leadId: existing.id }, select: { reference: true, status: true, scheduledAt: true } });
      return {
        leadId: existing.id,
        reference: existing.id.slice(-8).toUpperCase(),
        status: existing.status,
        duplicate: true,
        booking: bookingResult(existingBooking, false),
      };
    }
  }

  // Contact matching (dedupe across submissions)
  let contact = await tx.contact.findUnique({ where: { dedupeKey } });
  if (!contact) {
    contact = await tx.contact.create({
      data: { email, phoneE164: phone, name: input.name, dedupeKey, locale: input.preferredLocale },
    });
  } else {
    // enrich: fill missing fields
    await tx.contact.update({
      where: { id: contact.id },
      data: {
        name: contact.name ?? input.name,
        email: contact.email ?? email,
        phoneE164: contact.phoneE164 ?? phone,
        lastSeenAt: new Date(),
      },
    });
  }

  /* Entity resolution --------------------------------------------------
   * (U20 §40: moved AHEAD of the 24h soft-dedupe lookup so that slug-based
   * submissions — the standard public-form path — dedupe against the SAME
   * resolved entity id. Previously the lookup keyed on `input.entityId ??
   * null`, so two enquiries about the same property submitted by slug never
   * matched and produced duplicate leads.) */
  let entityId = input.entityId ?? null;
  let isExclusive = false;
  if (!entityId && input.entitySlug && input.entityType === "PROPERTY") {
    const prop = await tx.property.findUnique({ where: { slug: input.entitySlug }, select: { id: true, listings: { select: { isExclusive: true } } } });
    if (prop) {
      entityId = prop.id;
      isExclusive = prop.listings.some((l) => l.isExclusive);
    }
  } else if (entityId && input.entityType === "PROPERTY") {
    const listing = await tx.listing.findFirst({ where: { propertyId: entityId }, select: { isExclusive: true } });
    isExclusive = !!listing?.isExclusive;
  }

  // Soft duplicate detection: same contact + same entity within 24h → same lead, add event
  const recentDuplicate = await tx.lead.findFirst({
    where: {
      organizationId: organization.id,
      contactId: contact.id,
      primaryEntityId: entityId,
      createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
      intent: input.intent,
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentDuplicate) {
    await tx.leadEvent.create({
      data: { leadId: recentDuplicate.id, eventType: "REPEAT_SUBMISSION", payloadJson: JSON.stringify({ at: new Date().toISOString() }), actorType: "USER" },
    });
    const existingBooking = await tx.booking.findUnique({ where: { leadId: recentDuplicate.id }, select: { reference: true, status: true, scheduledAt: true } });
    const booking = existingBooking
      ? bookingResult(existingBooking, false)
      : await createRequestedBooking(tx, recentDuplicate.id, recentDuplicate.ownerAgentId, input);
    await recordFormTouchpoint(tx, options.attributionSessionId, recentDuplicate.id, input.pagePath ?? input.landingUrl);
    return {
      leadId: recentDuplicate.id,
      reference: recentDuplicate.id.slice(-8).toUpperCase(),
      status: recentDuplicate.status,
      duplicate: true,
      booking,
    };
  }

  /* Agent assignment: explicit agent > round-robin available --------------- */
  let ownerAgentId: string | null = null;
  let assignmentReason: string | null = null;
  if (input.agentSlug) {
    const agent = await tx.agent.findUnique({ where: { slug: input.agentSlug }, select: { id: true, active: true } });
    if (agent?.active) {
      ownerAgentId = agent.id;
      assignmentReason = "AGENT_PROFILE";
    }
  }
  if (!ownerAgentId) {
    const agent = await tx.agent.findFirst({
      where: { active: true, leadCapacityState: { not: "HIGH" } },
      orderBy: [{ leadCapacityState: "asc" }, { sortWeight: "desc" }],
      select: { id: true },
    });
    if (agent) {
      ownerAgentId = agent.id;
      assignmentReason = "ROUND_ROBIN";
    }
  }

  /* Deterministic score --------------------------------------------------- */
  const scoring = scoreLead(input, { hasEntity: !!entityId, isExclusive });

  /* Persist lead + context + consents + assignment atomically (transactional) */
  const lead = await tx.lead.create({
    data: {
      organizationId: organization.id,
      contactId: contact.id,
      intent: input.intent,
      status: "NEW",
      sourceChannel: input.sourceChannel,
      primaryEntityType: input.entityType ?? null,
      primaryEntityId: entityId,
      primaryEntitySlug: input.entitySlug ?? null,
      ownerAgentId,
      assignedAt: ownerAgentId ? new Date() : null,
      message: input.message ?? null,
      preferredLocale: input.preferredLocale,
      budgetMinMinor: input.budgetMin ? BigInt(input.budgetMin * 100) : null,
      budgetMaxMinor: input.budgetMax ? BigInt(input.budgetMax * 100) : null,
      dedupeKey: input.clientSubmissionId ? `form:${input.clientSubmissionId}` : null,
      propertyDetailsJson: input.propertyDetails ? safeJsonStringify(input.propertyDetails) : null,
    },
  });

  await tx.leadContext.create({
    data: {
      leadId: lead.id,
      landingUrl: safeAttributionPath(input.landingUrl),
      referrer: safeAttributionReferrer(input.referrer),
      utmSource: safeAttributionUtm(input.utmSource),
      utmMedium: safeAttributionUtm(input.utmMedium),
      utmCampaign: safeAttributionUtm(input.utmCampaign),
      utmContent: safeAttributionUtm(input.utmContent),
      utmTerm: safeAttributionUtm(input.utmTerm),
      searchStateJson: input.searchState ? JSON.stringify(input.searchState) : null,
      sessionId: options.attributionSessionId ?? null,
      locale: input.preferredLocale,
      deviceClass: input.deviceClass,
      pagePath: safeAttributionPath(input.pagePath),
      aiConversationId: input.aiConversationId,
    },
  });

  await tx.leadConsent.create({
    data: {
      leadId: lead.id,
      contactId: contact.id,
      purpose: "LEAD_CONTACT",
      status: "GRANTED",
      evidenceJson: JSON.stringify({ formId: "lead_form", checkboxLabel: "I agree to be contacted about this enquiry." }),
    },
  });
  if (input.consentMarketing) {
    await tx.leadConsent.create({
      data: {
        leadId: lead.id,
        contactId: contact.id,
        purpose: "MARKETING",
        status: "GRANTED",
        evidenceJson: JSON.stringify({ formId: "lead_form", checkboxLabel: "Send me relevant investment opportunities and market updates." }),
      },
    });
  }

  await tx.leadScore.create({
    data: {
      leadId: lead.id,
      score: scoring.score,
      band: scoring.band,
      reasonsJson: JSON.stringify(scoring.reasons),
    },
  });

  if (ownerAgentId) {
    await tx.leadAssignment.create({
      data: { leadId: lead.id, agentId: ownerAgentId, reason: assignmentReason ?? "ROUND_ROBIN", active: true },
    });
  }

  await tx.leadEvent.create({
    data: { leadId: lead.id, eventType: "CREATED", payloadJson: JSON.stringify({ intent: input.intent, score: scoring.score, band: scoring.band, assigned: !!ownerAgentId }), actorType: "USER" },
  });

  await recordFormTouchpoint(tx, options.attributionSessionId, lead.id, input.pagePath ?? input.landingUrl);

  /* Booking (consultation/viewing) ------------------------------------ */
  const booking = await createRequestedBooking(tx, lead.id, ownerAgentId, input);

  /* Transactional outbox → CRM delivery (F09: local-first durability) */
  await emitEvent("lead", lead.id, "lead.created", { leadId: lead.id }, tx);

  logEvent("lead.created", { leadId: lead.id, intent: input.intent, entity: input.entityType, score: scoring.score, assigned: !!ownerAgentId });

  return {
    leadId: lead.id,
    reference: lead.id.slice(-8).toUpperCase(),
    status: lead.status,
    duplicate: false,
    booking,
  };
}

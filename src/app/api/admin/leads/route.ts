import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { db, parseJson } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";
import { scopedLeadWhere } from "@/server/domain/resource-policy";
import { updateLeadAdminCommand } from "@/server/domain/lead-admin-command";

export const dynamic = "force-dynamic";

/** Leads queue (Q05/Q15): filter, inspect full context, update status/assignment */
export const GET = apiHandler(async (req) => {
  const user = await requirePermission("lead:read");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const intent = url.searchParams.get("intent") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = 15;

  const where = scopedLeadWhere(user, {
    ...(status ? { status } : {}),
    ...(intent ? { intent } : {}),
  });

  const [leads, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contact: true,
        ownerAgent: { select: { id: true, name: true } },
        context: true,
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        events: { orderBy: { createdAt: "desc" }, take: 5 },
        crmSyncRecords: { orderBy: { createdAt: "desc" }, take: 1 },
        booking: true,
      },
    }),
    db.lead.count({ where }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    leads: leads.map((l) => ({
      id: l.id,
      reference: l.id.slice(-8).toUpperCase(),
      intent: l.intent,
      status: l.status,
      sourceChannel: l.sourceChannel,
      contact: { name: l.contact.name, email: l.contact.email, phone: l.contact.phoneE164 },
      message: l.message,
      entity: { type: l.primaryEntityType, slug: l.primaryEntitySlug },
      ownerAgent: l.ownerAgent,
      score: l.scores[0] ? { score: l.scores[0].score, band: l.scores[0].band, reasons: JSON.parse(l.scores[0].reasonsJson ?? "[]") } : null,
      context: l.context
        ? {
            landingUrl: l.context.landingUrl,
            referrer: l.context.referrer,
            utmSource: l.context.utmSource,
            utmMedium: l.context.utmMedium,
            utmCampaign: l.context.utmCampaign,
            /* U20 (§40) audit surface — full captured attribution so admin can
             * verify lead-context completeness end-to-end. */
            utmContent: l.context.utmContent,
            utmTerm: l.context.utmTerm,
            pagePath: l.context.pagePath,
            sessionId: l.context.sessionId,
            aiConversationId: l.context.aiConversationId,
            searchState: parseJson<Record<string, unknown> | null>(l.context.searchStateJson, null),
            deviceClass: l.context.deviceClass,
            locale: l.context.locale,
          }
        : null,
      crmStatus: l.crmSyncRecords[0]?.status ?? null,
      crmAttempts: l.crmSyncRecords[0]?.attempts ?? 0,
      booking: l.booking ? { id: l.booking.id, reference: l.booking.reference, scheduledAt: l.booking.scheduledAt.toISOString(), status: l.booking.status, updatedAt: l.booking.updatedAt.toISOString() } : null,
      events: l.events.map((e) => ({ type: e.eventType, at: e.createdAt.toISOString() })),
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
  });
});

const patchSchema = z.object({
  leadId: z.string(),
  expectedUpdatedAt: z.string().datetime(),
  status: z.enum(["NEW", "ATTEMPTED", "CONTACTED", "QUALIFIED", "NURTURE", "WON", "LOST", "SPAM"]).optional(),
  ownerAgentId: z.string().nullable().optional(),
  note: z.string().max(1000).optional(),
}).strict();

export const PATCH = apiHandler(async (req) => {
  const user = await requirePermission("lead:update");
  const raw = await jsonBody<z.infer<typeof patchSchema>>(req);
  const input = patchSchema.parse(raw);
  return NextResponse.json(await updateLeadAdminCommand(user, input, clientIp(req)));
});

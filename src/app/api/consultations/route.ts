import { NextResponse } from "next/server";
import { z } from "zod";
import { preferredBookingTimeSchema, submitLead } from "@/server/domain/lead-service";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { getConfig } from "@/lib/config";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { grantedAnalyticsSessionId } from "@/server/privacy/analytics-attribution";

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  preferredLocale: z.string().max(5).default("en"),
  scheduledAt: preferredBookingTimeSchema,
  bookingType: z.enum(["CONSULTATION", "VIEWING", "CALLBACK"]).default("CONSULTATION"),
  channel: z.enum(["OFFICE", "VIDEO", "PHONE", "WHATSAPP"]).default("OFFICE"),
  topic: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  consentContact: z.literal(true),
  consentMarketing: z.boolean().default(false),
  entityType: z.enum(["PROPERTY", "PROJECT", "COMMUNITY", "DEVELOPER", "AGENT", "MARKET_REPORT", "GUIDE", "PAGE"]).optional(),
  entityId: z.string().max(64).optional(),
  entitySlug: z.string().max(200).optional(),
  entityTitle: z.string().max(300).optional(),
  agentSlug: z.string().max(200).optional(),
  landingUrl: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  /* U20 (§40 CRM/lead continuity) additive context capture: full UTM set,
   * page path, session/device, search filters, AI conversation linkage and
   * client idempotency — the leadSubmitSchema already persists every field;
   * this route previously dropped them. All optional → backward compatible. */
  utmContent: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  pagePath: z.string().max(300).optional(),
  sessionId: z.string().max(64).optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP"]).optional(),
  searchState: z.record(z.string(), z.unknown()).optional(),
  aiConversationId: z.string().max(64).optional(),
  clientSubmissionId: z.string().max(64).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const config = getConfig();
    const rl = rateLimit(`lead:${clientIp(req)}`, config.RATE_LIMIT_LEAD_PER_HOUR, 3600_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many booking attempts. Please try later.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);
    const result = await submitLead({
      intent: "CONSULT",
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      scheduledAt: input.scheduledAt,
      bookingType: input.bookingType,
      channel: input.channel,
      topic: input.topic ?? input.entityTitle,
      consentContact: true,
      consentMarketing: input.consentMarketing,
      preferredLocale: input.preferredLocale,
      entityType: input.entityType,
      entityId: input.entityId,
      entitySlug: input.entitySlug,
      entityTitle: input.entityTitle,
      agentSlug: input.agentSlug,
      sourceChannel: "WEBSITE",
      landingUrl: input.landingUrl,
      referrer: input.referrer,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      pagePath: input.pagePath,
      sessionId: input.sessionId,
      deviceClass: input.deviceClass,
      searchState: input.searchState,
      aiConversationId: input.aiConversationId,
      clientSubmissionId: input.clientSubmissionId,
    }, { attributionSessionId: await grantedAnalyticsSessionId(req) });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  },
  { rateLimit: { limit: 10, windowMs: 3600_000, key: "consult" } }
);

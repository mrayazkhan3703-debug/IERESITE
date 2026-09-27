import { NextResponse } from "next/server";
import { z } from "zod";
import { submitLead } from "@/server/domain/lead-service";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { getConfig } from "@/lib/config";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { grantedAnalyticsSessionId } from "@/server/privacy/analytics-attribution";

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  propertyType: z.string().max(40).optional(),
  community: z.string().max(120).optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  areaSqft: z.number().int().min(0).max(200000).optional(),
  message: z.string().max(2000).optional(),
  consentContact: z.literal(true),
  consentMarketing: z.boolean().default(false),
  preferredLocale: z.string().max(5).default("en"),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  /* U20 (§40) additive attribution capture — previously dropped on this route:
   * full UTM set + landing page, referrer, page path, session/device and
   * client idempotency. All optional → backward compatible. */
  utmContent: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  landingUrl: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  pagePath: z.string().max(300).optional(),
  sessionId: z.string().max(64).optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP"]).optional(),
  clientSubmissionId: z.string().max(64).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const config = getConfig();
    const rl = rateLimit(`valuation:${clientIp(req)}`, config.RATE_LIMIT_LEAD_PER_HOUR, 3600_000);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests. Please try later.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);
    const result = await submitLead({
      intent: "VALUATION",
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: [
        input.propertyType && `Property type: ${input.propertyType}`,
        input.community && `Community: ${input.community}`,
        input.bedrooms !== undefined && `Bedrooms: ${input.bedrooms}`,
        input.areaSqft && `Area: ${input.areaSqft} sqft`,
        input.message,
      ]
        .filter(Boolean)
        .join("\n"),
      consentContact: true,
      consentMarketing: input.consentMarketing,
      preferredLocale: input.preferredLocale,
      entityType: "PAGE",
      entitySlug: "sell/valuation",
      entityTitle: "Property valuation request",
      sourceChannel: "WEBSITE",
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      landingUrl: input.landingUrl,
      referrer: input.referrer,
      pagePath: input.pagePath,
      sessionId: input.sessionId,
      deviceClass: input.deviceClass,
      clientSubmissionId: input.clientSubmissionId,
    }, { attributionSessionId: await grantedAnalyticsSessionId(req) });
    return NextResponse.json(result, { status: 201 });
  },
  { rateLimit: { limit: 10, windowMs: 3600_000, key: "valuation" } }
);

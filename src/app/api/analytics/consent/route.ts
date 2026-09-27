import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import {
  createVisitorConsentToken,
  CURRENT_CONSENT_POLICY_VERSION,
  hashVisitorConsentToken,
  readVisitorConsentToken,
  visitorConsentCookie,
} from "@/server/privacy/visitor-consent";
import { safeAttributionPath, safeAttributionReferrer, safeAttributionUtm } from "@/server/privacy/analytics-attribution";

const schema = z.object({
  essential: z.literal(true),
  analytics: z.boolean(),
  marketing: z.boolean(),
  personalization: z.boolean(),
  source: z.enum(["COOKIE_BANNER", "FORM_CHECKBOX", "ACCOUNT_SETTINGS"]).default("COOKIE_BANNER"),
  landingPath: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
}).strict();

export const GET = apiHandler(async (req) => {
  const token = readVisitorConsentToken(req);
  if (!token) return NextResponse.json({ decided: false, analytics: false, marketing: false, personalization: false });

  const sessionKey = hashVisitorConsentToken(token);
  const rows = await db.consent.findMany({
    where: {
      subjectType: "VISITOR",
      sessionKey,
      policyVersion: CURRENT_CONSENT_POLICY_VERSION,
      purpose: { in: ["ANALYTICS", "MARKETING", "PERSONALIZATION"] },
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    select: { purpose: true, status: true },
  });
  const latest = new Map<string, string>();
  for (const row of rows) if (!latest.has(row.purpose)) latest.set(row.purpose, row.status);
  const decided = ["ANALYTICS", "MARKETING", "PERSONALIZATION"].every((purpose) => latest.has(purpose));
  return NextResponse.json({
    decided,
    analytics: latest.get("ANALYTICS") === "GRANTED",
    marketing: latest.get("MARKETING") === "GRANTED",
    personalization: latest.get("PERSONALIZATION") === "GRANTED",
  });
});

/** Consent record trail (privacy evidence — C087) */
export const POST = apiHandler(
  async (req) => {
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const input = schema.parse(raw);
    const token = readVisitorConsentToken(req) ?? createVisitorConsentToken();
    const sessionKey = hashVisitorConsentToken(token);

    const purposes = [
      ["ANALYTICS", input.analytics],
      ["MARKETING", input.marketing],
      ["PERSONALIZATION", input.personalization],
    ] as const;
    const capturedAt = new Date();
    const firstTouch = input.analytics
      ? {
          landingPath: safeAttributionPath(input.landingPath),
          referrer: safeAttributionReferrer(input.referrer),
          utmSource: safeAttributionUtm(input.utmSource),
          utmMedium: safeAttributionUtm(input.utmMedium),
          utmCampaign: safeAttributionUtm(input.utmCampaign),
        }
      : {};
    await db.$transaction(async (tx) => {
      let session = await tx.websiteSession.upsert({
        where: { sessionKey },
        create: { sessionKey, ...firstTouch },
        update: { lastSeenAt: capturedAt },
      });
      if (input.analytics) {
        const firstTouchMissing = !session.landingPath && !session.referrer && !session.utmSource && !session.utmMedium && !session.utmCampaign;
        if (firstTouchMissing) {
          const updated = await tx.websiteSession.updateMany({
            where: {
              id: session.id,
              landingPath: null,
              referrer: null,
              utmSource: null,
              utmMedium: null,
              utmCampaign: null,
            },
            data: firstTouch,
          });
          if (updated.count) session = await tx.websiteSession.findUniqueOrThrow({ where: { id: session.id } });
        }
        if (session.landingPath) {
          await tx.attributionTouchpoint.createMany({
            data: [{
              id: `${session.id}:landing`,
              sessionId: session.id,
              touchType: "LANDING",
              path: safeAttributionPath(session.landingPath),
              occurredAt: capturedAt,
            }],
            skipDuplicates: true,
          });
        }
      }
      await Promise.all(purposes.map(([purpose, granted]) => tx.consent.create({
        data: {
          subjectType: "VISITOR",
          sessionKey,
          purpose,
          status: granted ? "GRANTED" : "DENIED",
          source: input.source,
          policyVersion: CURRENT_CONSENT_POLICY_VERSION,
          capturedAt,
          evidenceJson: JSON.stringify({ capturedAt: capturedAt.toISOString(), via: input.source }),
        },
      })));
    });

    return NextResponse.json({ recorded: purposes.length }, {
      headers: { "Set-Cookie": visitorConsentCookie(token, process.env.NODE_ENV === "production") },
    });
  },
  { rateLimit: { limit: 20, windowMs: 60_000, key: "consent" } }
);

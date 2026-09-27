import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { db } from "@/lib/db";
import { CURRENT_CONSENT_POLICY_VERSION, hashVisitorConsentToken, readVisitorConsentToken } from "@/server/privacy/visitor-consent";
import { safeAttributionPath } from "@/server/privacy/analytics-attribution";
import { isAnalyticsEventName } from "@/lib/analytics-events";

const schema = z.object({
  events: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        path: z.string().max(300).optional(),
        locale: z.enum(["en", "ar"]).optional(),
      }).strict()
    )
    .min(1)
    .max(50),
}).strict();

const ESSENTIAL_EVENTS = new Set(["page_view", "form_start", "form_complete", "lead_generated", "consultation_request_submitted"]);

export const POST = apiHandler(
  async (req) => {
    const raw = await jsonBody<z.infer<typeof schema>>(req);
    const body = schema.parse(raw);

    const token = readVisitorConsentToken(req);
    const sessionKey = token ? hashVisitorConsentToken(token) : null;
    const session = sessionKey
      ? await db.websiteSession.findUnique({ where: { sessionKey }, select: { id: true } })
      : null;
    const consentRows = sessionKey
      ? await db.consent.findMany({
          where: { subjectType: "VISITOR", sessionKey, policyVersion: CURRENT_CONSENT_POLICY_VERSION, purpose: "ANALYTICS" },
          orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
          select: { status: true },
        })
      : [];
    const analyticsGranted = consentRows[0]?.status === "GRANTED";
    const valid = body.events.filter((event) =>
      isAnalyticsEventName(event.name) && (ESSENTIAL_EVENTS.has(event.name) || analyticsGranted)
    );
    await db.$transaction(async (tx) => {
      for (const ev of valid) {
        // Analytics rollups use event names and counts only. Never persist
        // browser-supplied values, even when a client sends a legacy payload.
        await tx.analyticsEvent.create({
          data: {
            sessionId: session?.id ?? null,
            name: ev.name,
            path: safeAttributionPath(ev.path),
            locale: ev.locale?.slice(0, 5) ?? "en",
          },
        });

        if (session && analyticsGranted && (ev.name === "call_click" || ev.name === "whatsapp_click")) {
          await tx.attributionTouchpoint.create({
            data: {
              sessionId: session.id,
              touchType: ev.name === "call_click" ? "CALL_CLICK" : "WHATSAPP_CLICK",
              path: safeAttributionPath(ev.path),
            },
          });
        }
      }

      if (session) {
        await tx.websiteSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      }
    });
    return NextResponse.json({ accepted: valid.length, rejected: body.events.length - valid.length });
  },
  { rateLimit: { limit: 60, windowMs: 60_000, key: "analytics" } }
);

import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { GET as getConsent, POST as postConsent } from "@/app/api/analytics/consent/route";
import { POST as postEvents } from "@/app/api/analytics/events/route";
import { hashVisitorConsentToken, VISITOR_CONSENT_COOKIE } from "@/server/privacy/visitor-consent";
import { grantedAnalyticsSessionId } from "@/server/privacy/analytics-attribution";

const consentSessionKeys: string[] = [];
const startedAt = new Date();

afterAll(async () => {
  const sessions = consentSessionKeys.length
    ? await db.websiteSession.findMany({ where: { sessionKey: { in: consentSessionKeys } }, select: { id: true } })
    : [];
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length) await db.analyticsEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
  if (sessionIds.length) await db.attributionTouchpoint.deleteMany({ where: { sessionId: { in: sessionIds } } });
  if (consentSessionKeys.length) await db.consent.deleteMany({ where: { sessionKey: { in: consentSessionKeys } } });
  if (sessionIds.length) await db.websiteSession.deleteMany({ where: { id: { in: sessionIds } } });
  await db.consent.deleteMany({
    where: { subjectType: "VISITOR", createdAt: { gte: startedAt }, source: { in: ["ACCOUNT_SETTINGS", "COOKIE_BANNER"] } },
  });
  await db.$disconnect();
});

async function submitConsent(body: Record<string, unknown>, cookie?: string) {
  const request = new Request("http://localhost/api/analytics/consent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return postConsent(request, undefined);
}

async function submitEvents(events: Record<string, unknown>[], cookie?: string) {
  const request = new Request("http://localhost/api/analytics/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "fetch",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ events }),
  });
  return postEvents(request, undefined);
}

async function readConsent(cookie?: string) {
  return getConsent(new Request("http://localhost/api/analytics/consent", {
    headers: cookie ? { cookie } : undefined,
  }), undefined);
}

function cookieFrom(response: Response): { pair: string; token: string; sessionKey: string } {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const pair = setCookie.split(";", 1)[0] ?? "";
  const prefix = `${VISITOR_CONSENT_COOKIE}=`;
  expect(pair.startsWith(prefix)).toBe(true);
  const token = pair.slice(prefix.length);
  const sessionKey = hashVisitorConsentToken(token);
  consentSessionKeys.push(sessionKey);
  return { pair, token, sessionKey };
}

describe("visitor consent evidence and server-side event authorization", () => {
  it("stores choices atomically with their source/version and issues a session-only HttpOnly identifier", async () => {
    const response = await submitConsent({
      essential: true,
      analytics: false,
      marketing: true,
      personalization: false,
      source: "ACCOUNT_SETTINGS",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: 3 });
    const { pair, token, sessionKey } = cookieFrom(response);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).not.toContain("Max-Age");
    expect(await (await readConsent(pair)).json()).toMatchObject({
      decided: true,
      analytics: false,
      marketing: true,
      personalization: false,
    });

    const rows = await db.consent.findMany({
      where: { subjectType: "VISITOR", source: "ACCOUNT_SETTINGS", sessionKey, createdAt: { gte: startedAt } },
      orderBy: { purpose: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map(({ purpose, status, policyVersion }) => ({ purpose, status, policyVersion }))).toEqual([
      { purpose: "ANALYTICS", status: "DENIED", policyVersion: "2026-09-v1" },
      { purpose: "MARKETING", status: "GRANTED", policyVersion: "2026-09-v1" },
      { purpose: "PERSONALIZATION", status: "DENIED", policyVersion: "2026-09-v1" },
    ]);

    const invalidEssential = await submitConsent({
      essential: false,
      analytics: true,
      marketing: false,
      personalization: false,
      source: "COOKIE_BANNER",
    }, pair);
    const callerChosenSession = await submitConsent({
      essential: true,
      analytics: true,
      marketing: false,
      personalization: false,
      source: "COOKIE_BANNER",
      sid: "caller-controlled",
    }, pair);
    expect(invalidEssential.status).toBe(400);
    expect(callerChosenSession.status).toBe(400);
  });

  it("accepts non-essential analytics events only when the linked server record grants analytics consent", async () => {
    expect(await (await readConsent()).json()).toEqual({ decided: false, analytics: false, marketing: false, personalization: false });
    const noCookie = await submitEvents([{ name: "search" }]);
    expect(await noCookie.json()).toEqual({ accepted: 0, rejected: 1 });

    const createDeniedSession = await submitConsent({
      essential: true,
      analytics: false,
      marketing: false,
      personalization: false,
      source: "COOKIE_BANNER",
    });
    const cookie = cookieFrom(createDeniedSession);
    const session = await db.websiteSession.findUniqueOrThrow({ where: { sessionKey: cookie.sessionKey } });
    expect(await (await readConsent(cookie.pair)).json()).toEqual({ decided: true, analytics: false, marketing: false, personalization: false });

    const denied = await submitEvents([
      { name: "search", path: "/search", locale: "en" },
      { name: "page_view", path: "/", locale: "en" },
      { name: "consultation_request_submitted", path: "/consultation", locale: "en" },
      { name: "consultation_booked", path: "/consultation", locale: "en" },
      { name: "call_click", path: "/contact" },
    ], cookie.pair);
    expect(await denied.json()).toEqual({ accepted: 2, rejected: 3 });
    expect(await grantedAnalyticsSessionId(new Request("http://localhost", { headers: { cookie: cookie.pair } }))).toBeNull();

    const grant = await submitConsent({
      essential: true,
      analytics: true,
      marketing: false,
      personalization: false,
      source: "ACCOUNT_SETTINGS",
      landingPath: "/campaign/launch?email=private@example.invalid",
      referrer: "https://campaign.example.invalid/source?phone=0501234567#fragment",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch-2026",
    }, cookie.pair);
    expect(grant.status).toBe(200);
    expect((await (await readConsent(cookie.pair)).json()).analytics).toBe(true);
    expect(await grantedAnalyticsSessionId(new Request("http://localhost", { headers: { cookie: cookie.pair } }))).toBe(session.id);
    const sourceSession = await db.websiteSession.findUniqueOrThrow({ where: { id: session.id } });
    expect({ landingPath: sourceSession.landingPath, referrer: sourceSession.referrer, utmSource: sourceSession.utmSource, utmMedium: sourceSession.utmMedium, utmCampaign: sourceSession.utmCampaign }).toEqual({
      landingPath: "/campaign/launch",
      referrer: "https://campaign.example.invalid/source",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch-2026",
    });
    const allowed = await submitEvents([
      { name: "search", path: "/search", locale: "en" },
      { name: "call_click", path: "/contact?email=private@example.invalid" },
      { name: "whatsapp_click", path: "/properties/synthetic?phone=0501234567" },
    ], cookie.pair);
    expect(await allowed.json()).toEqual({ accepted: 3, rejected: 0 });

    const legacyPayload = await submitEvents([{
      name: "search",
      payloadJson: { query: "person@example.invalid", filters: { note: "0501234567" } },
    }], cookie.pair);
    expect(legacyPayload.status).toBe(400);

    const unsupportedLocale = await submitEvents([{ name: "search", locale: "fr" }], cookie.pair);
    expect(unsupportedLocale.status).toBe(400);
    const touchpoints = await db.attributionTouchpoint.findMany({ where: { sessionId: session.id }, orderBy: { occurredAt: "asc" } });
    expect(touchpoints.map(({ touchType, path }) => ({ touchType, path }))).toEqual([
      { touchType: "LANDING", path: "/campaign/launch" },
      { touchType: "CALL_CLICK", path: "/contact" },
      { touchType: "WHATSAPP_CLICK", path: "/properties/synthetic" },
    ]);
    expect(touchpoints.every((touchpoint) => touchpoint.entityContextJson === null)).toBe(true);

    const revoke = await submitConsent({
      essential: true,
      analytics: false,
      marketing: false,
      personalization: false,
      source: "ACCOUNT_SETTINGS",
    }, cookie.pair);
    expect(revoke.status).toBe(200);
    expect((await (await readConsent(cookie.pair)).json()).analytics).toBe(false);
    expect(await grantedAnalyticsSessionId(new Request("http://localhost", { headers: { cookie: cookie.pair } }))).toBeNull();
    const deniedAgain = await submitEvents([{ name: "search" }], cookie.pair);
    expect(await deniedAgain.json()).toEqual({ accepted: 0, rejected: 1 });

    const storedEvents = await db.analyticsEvent.findMany({ where: { sessionId: session.id }, select: { name: true, payloadJson: true } });
    expect(storedEvents.map((event) => event.name).sort()).toEqual(["call_click", "consultation_request_submitted", "page_view", "search", "whatsapp_click"]);
    expect(storedEvents.every((event) => event.payloadJson === null)).toBe(true);
  });
});

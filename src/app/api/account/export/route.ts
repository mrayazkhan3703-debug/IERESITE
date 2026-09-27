import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requireUser, audit } from "@/server/auth";
import { db, parseJson } from "@/lib/db";
import { clientIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Data export (DSR): all personal data for the authenticated account */
export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const [profile, favorites, savedSearches, consents, conversations, comparisons, recentlyViewed, notifications, holdings, documents, requests] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, createdAt: true, updatedAt: true, emailVerified: true, profile: true } }),
    db.favorite.findMany({ where: { userId: user.id }, include: { property: { select: { slug: true, title: true } } } }),
    db.savedSearch.findMany({ where: { userId: user.id } }),
    db.consent.findMany({ where: { userId: user.id } }),
    db.aiConversation.findMany({ where: { userId: user.id }, include: { messages: true } }),
    db.comparison.findMany({ where: { userId: user.id }, include: { items: { include: { property: { select: { slug: true, title: true } } } } } }),
    db.recentlyViewed.findMany({ where: { userId: user.id }, include: { property: { select: { slug: true, title: true } } } }),
    db.notification.findMany({ where: { userId: user.id } }),
    db.portfolioHolding.findMany({ where: { userId: user.id } }),
    db.portfolioDocument.findMany({ where: { userId: user.id }, select: { id: true, category: true, label: true, holdingId: true, createdAt: true } }),
    db.dataSubjectRequest.findMany({ where: { userId: user.id }, select: { id: true, requestType: true, status: true, createdAt: true, completedAt: true } }),
  ]);

  await audit({
    actorType: "USER",
    actorId: user.id,
    action: "privacy.export",
    resourceType: "user",
    resourceId: user.id,
    ip: clientIp(req),
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    account: profile,
    favorites: favorites.map((f) => ({ property: f.property.title, slug: f.property.slug, savedAt: f.createdAt })),
    savedSearches: savedSearches.map((s) => ({ name: s.name, criteria: parseJson(s.searchStateJson, {}), alerts: s.alertConsent ? s.alertFrequency : "off" })),
    consents: consents.map((c) => ({ purpose: c.purpose, status: c.status, capturedAt: c.capturedAt })),
    aiConversations: conversations.map((c) => ({
      id: c.id,
      status: c.status,
      messages: c.messages.map((m) => ({ role: m.role, content: m.content, at: m.createdAt })),
    })),
    comparisons: comparisons.map((comparison) => ({ name: comparison.name, properties: comparison.items.map((item) => ({ slug: item.property.slug, title: item.property.title })) })),
    recentlyViewed: recentlyViewed.map((item) => ({ property: item.property, viewedAt: item.viewedAt })),
    notifications,
    portfolio: { holdings, documents },
    dataSubjectRequests: requests,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="investment-experts-data-export.json"`,
    },
  });
});

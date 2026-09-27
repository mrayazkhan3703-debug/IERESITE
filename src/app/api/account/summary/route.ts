import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Account dashboard counts (U14 §24): server-side counts for the cards that
 * live in the user's account (saved searches, alert subscriptions, AI
 * conversations, portfolio holdings/documents, and synchronized saved state).
 */
export const GET = apiHandler(async () => {
  const user = await requireUser();
  const [savedSearches, alertSubscriptions, conversations, holdings, documents, favorites, comparisons, recentlyViewed] = await Promise.all([
    db.savedSearch.count({ where: { userId: user.id } }),
    db.notificationSubscription.count({ where: { userId: user.id } }),
    db.aiConversation.count({ where: { userId: user.id } }),
    db.portfolioHolding.count({ where: { userId: user.id } }),
    db.portfolioDocument.count({ where: { userId: user.id } }),
    db.favorite.count({ where: { userId: user.id } }),
    db.comparison.count({ where: { userId: user.id } }),
    db.recentlyViewed.count({ where: { userId: user.id } }),
  ]);
  return NextResponse.json({
    savedSearches,
    alertSubscriptions,
    conversations,
    holdings,
    documents,
    favorites,
    comparisons,
    recentlyViewed,
  });
});

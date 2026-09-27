import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { requireUser, audit } from "@/server/auth";
import { db } from "@/lib/db";
import { deletePrivateObject } from "@/server/storage/object-store";

export const dynamic = "force-dynamic";

/** Delete one of the user's own portfolio documents (ownership via userId filter). */
export const DELETE = apiHandler(
  async (_req, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const doc = await db.portfolioDocument.findFirst({
      where: { id, userId: user.id },
      select: { id: true, category: true, mediaAssetId: true, media: { select: { storageKey: true, isPrivate: true } } },
    });
    if (!doc) return NextResponse.json({ error: "Document not found", code: "NOT_FOUND" }, { status: 404 });

    await db.$transaction(async (tx) => {
      await tx.portfolioDocument.delete({ where: { id } });
      if (doc.media.isPrivate) await tx.mediaAsset.delete({ where: { id: doc.mediaAssetId } });
      await audit({
        actorType: "USER",
        actorId: user.id,
        action: "portfolio.document.deleted",
        resourceType: "PortfolioDocument",
        resourceId: id,
        after: { category: doc.category },
      }, tx);
    });
    if (doc.media.isPrivate) await deletePrivateObject(doc.media.storageKey).catch(() => {});
    return NextResponse.json({ ok: true });
  },
  { rateLimit: { limit: 60, windowMs: 3600_000, key: "portfolio-doc" } }
);

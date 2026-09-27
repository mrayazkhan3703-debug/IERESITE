import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { requireUser, audit } from "@/server/auth";
import { db } from "@/lib/db";
import { storeUpload } from "@/server/media/pipeline";
import { signedPrivateObjectUrl } from "@/server/storage/object-store";

export const dynamic = "force-dynamic";

const CATEGORIES = ["SPA", "TITLE_DEED", "OQOOD", "RECEIPT", "FLOOR_PLAN", "MORTGAGE", "TENANCY"] as const;

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  holdingId: z.string().max(64).optional(),
  label: z.string().max(160).optional(),
});

/**
 * Portfolio documents (V2 §25.6, U15). Strict per-user authorization:
 * GET only ever returns the signed-in user's own documents; POST validates
 * ownership of the target holding before linking. Uploads run through the
 * existing media pipeline (magic-byte MIME sniffing, size cap, extension
 * allowlist: JPEG/PNG/WebP/AVIF/PDF) — the admin media endpoint requires
 * media:create permission, so this route is the minimal secure user-facing
 * equivalent scoped to portfolio categories.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const holdingId = url.searchParams.get("holdingId") ?? undefined;

  const docs = await db.portfolioDocument.findMany({
    where: { userId: user.id, ...(holdingId ? { holdingId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { media: true, holding: { select: { label: true } } },
  });
  return NextResponse.json({
    documents: await Promise.all(docs.map(async (d) => ({
      id: d.id,
      category: d.category,
      holdingId: d.holdingId,
      holdingLabel: d.holding?.label ?? null,
      label: d.label,
      media: {
        id: d.media.id,
        url: await signedPrivateObjectUrl(d.media.storageKey),
        expiresInSeconds: 300,
        mimeType: d.media.mimeType,
        sizeBytes: d.media.sizeBytes,
        kind: d.media.kind,
      },
      createdAt: d.createdAt.toISOString(),
    }))),
    categories: CATEGORIES,
  });
});

export const POST = apiHandler(
  async (req) => {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    const parsed = createSchema.parse({
      category: form.get("category"),
      holdingId: form.get("holdingId") || undefined,
      label: form.get("label") || undefined,
    });

    // Holding ownership check before linking (never trust the client id).
    if (parsed.holdingId) {
      const holding = await db.portfolioHolding.findFirst({
        where: { id: parsed.holdingId, userId: user.id },
        select: { id: true },
      });
      if (!holding) {
        return NextResponse.json({ error: "Holding not found for this account", code: "NOT_FOUND" }, { status: 404 });
      }
    }

    const count = await db.portfolioDocument.count({ where: { userId: user.id } });
    if (count >= 200) {
      return NextResponse.json({ error: "Document limit reached (200).", code: "LIMIT" }, { status: 400 });
    }

    const stored = await storeUpload(file, { altText: parsed.label, uploadedBy: user.id, private: true });
    const doc = await db.portfolioDocument.create({
      data: {
        userId: user.id,
        holdingId: parsed.holdingId ?? null,
        category: parsed.category,
        mediaAssetId: stored.id,
        label: parsed.label ?? null,
      },
    });
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "portfolio.document.uploaded",
      resourceType: "PortfolioDocument",
      resourceId: doc.id,
      after: { category: parsed.category, holdingId: parsed.holdingId ?? null, mediaId: stored.id },
    });
    return NextResponse.json(
      {
        id: doc.id,
        category: doc.category,
        holdingId: doc.holdingId,
        label: doc.label,
        media: {
          id: stored.id,
          url: await signedPrivateObjectUrl(stored.storageKey),
          expiresInSeconds: 300,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          kind: stored.kind,
        },
      },
      { status: 201 }
    );
  },
  { rateLimit: { limit: 20, windowMs: 3600_000, key: "portfolio-doc" } }
);

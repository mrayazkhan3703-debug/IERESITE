import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { db } from "@/lib/db";
import { createContentDraft, updateContentDraft } from "@/server/domain/content-command";
import { parseContentBlocks, readContentBlocks } from "@/lib/content-blocks";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  await requirePermission("content:read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const locale = url.searchParams.get("locale");
  const where = {
    contentType: { not: "MARKET_REPORT" },
    ...(locale && ["en", "ar"].includes(locale) ? { locale } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const entries = await db.contentEntry.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      _count: { select: { revisions: true } },
      translationGroup: { include: { entries: { select: { id: true, locale: true, slug: true, title: true, updatedAt: true } } } },
    },
  });
  return NextResponse.json({
    entries: entries.map((entry) => {
      const translationPeer = entry.translationGroup?.entries.find((candidate) => candidate.id !== entry.id);
      return {
        id: entry.id, contentType: entry.contentType, locale: entry.locale, slug: entry.slug,
        title: entry.title, excerpt: entry.excerpt, body: entry.body, blocks: readContentBlocks(entry.bodyJson), category: entry.category,
        coverMediaId: entry.coverMediaId,
        status: entry.status, reviewWorkflowState: entry.reviewWorkflowState,
        sourceName: entry.sourceName, sourceUrl: entry.sourceUrl,
        sourceVerifiedAt: entry.sourceVerifiedAt?.toISOString() ?? null,
        publishedAt: entry.publishedAt?.toISOString() ?? null,
        revisionCount: entry._count.revisions, updatedAt: entry.updatedAt.toISOString(),
        translationPeer: translationPeer ? { ...translationPeer, updatedAt: translationPeer.updatedAt.toISOString() } : null,
      };
    }),
  });
});

const baseDraftSchema = z.object({
  slug: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(300),
  excerpt: z.string().max(1000).nullable().optional(),
  body: z.string().max(50000).optional().default(""),
  blocks: z.unknown().nullable().optional().refine((value) => value === undefined || value === null || parseContentBlocks(value) !== null),
  category: z.string().max(100).nullable().optional(),
  coverMediaId: z.string().min(1).nullable().optional(),
});

const createSchema = baseDraftSchema.extend({
  contentType: z.enum(["GUIDE", "AREA_GUIDE", "ARTICLE"]),
  locale: z.enum(["en", "ar"]),
}).strict();

const patchSchema = baseDraftSchema.extend({
  contentEntryId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  submitForReview: z.boolean().optional(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = createSchema.parse(await jsonBody<z.infer<typeof createSchema>>(req));
  return NextResponse.json(await createContentDraft(actor, input, clientIp(req)), { status: 201 });
});

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = patchSchema.parse(await jsonBody<z.infer<typeof patchSchema>>(req));
  return NextResponse.json(await updateContentDraft(actor, input, clientIp(req)));
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { clientIp } from "@/server/rate-limit";
import { createRagSource } from "@/server/domain/rag-admin-command";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requirePermission("content:read");
  const sources = await db.ragSource.findMany({
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    take: 100,
    include: {
      _count: { select: { documents: true } },
      documents: {
        take: 100,
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
        select: { id: true, sourceId: true, title: true, slug: true, locale: true,
          status: true, version: true, createdById: true, updatedById: true,
          approvedById: true, approvedAt: true, createdAt: true, updatedAt: true,
          _count: { select: { chunks: true, revisions: true } } },
      },
    },
  });
  const total = await db.ragSource.count();
  return NextResponse.json({ total, sourcesTruncated: total > sources.length, sources: sources.map((source) => ({
    ...source,
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    freshnessReviewDueAt: source.freshnessReviewDueAt?.toISOString() ?? null,
    approvedAt: source.approvedAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    documentsTruncated: source._count.documents > source.documents.length,
    documentCount: source._count.documents,
    _count: undefined,
    documents: source.documents.map((document) => ({
      ...document,
      approvedAt: document.approvedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      chunkCount: document._count.chunks,
      revisionCount: document._count.revisions,
      _count: undefined,
    })),
  })) }, { headers: { "Cache-Control": "private, no-store" } });
});

const schema = z.object({
  title: z.string().trim().min(1).max(240),
  sourceType: z.enum(["INTERNAL_DOC", "OFFICIAL", "NEWS", "REPORT", "GUIDE"]),
  canonicalUrl: z.string().max(2000).nullable().optional(),
  publisher: z.string().max(240).nullable().optional(),
  version: z.string().max(120).nullable().optional(),
  trustTier: z.enum(["INTERNAL", "OFFICIAL", "SECONDARY", "UNVERIFIED"]),
  verifiedAt: z.string().datetime(),
  freshnessReviewDueAt: z.string().datetime(),
  isActive: z.boolean(),
}).strict();

export const POST = apiHandler(async (req) => {
  const actor = await requirePermission("content:update");
  const input = schema.parse(await jsonBody<z.infer<typeof schema>>(req));
  return NextResponse.json(await createRagSource(actor, input, clientIp(req)), { status: 201 });
});

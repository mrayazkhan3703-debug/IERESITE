import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { storeUpload } from "@/server/media/pipeline";
import { db } from "@/lib/db";
import { z } from "zod";
import { updateMediaMetadata } from "@/server/domain/media-command";
import { clientIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Media upload (admin/CONTENT_EDITOR): validation + derivatives + registration */
export const POST = apiHandler(
  async (req) => {
    const user = await requirePermission("media:create");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    const altText = (form.get("altText") as string | null)?.slice(0, 300) ?? undefined;
    const stored = await storeUpload(file, { altText, uploadedBy: user.id });
    return NextResponse.json(stored, { status: 201 });
  },
  { rateLimit: { limit: 10, windowMs: 3600_000, key: "upload" } }
);

export const GET = apiHandler(async (req) => {
  await requirePermission("media:read");
  const url = new URL(req.url);
  const requestedTake = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isInteger(requestedTake) && requestedTake > 0 ? Math.min(requestedTake, 100) : 50;
  const media = await db.mediaAsset.findMany({
    where: { isPrivate: false },
    orderBy: { createdAt: "desc" },
    take,
    include: { _count: { select: { propertyMedia: true, projectMedia: true, floorPlans: true, documents: true, portfolioDocuments: true } } },
  });
  const ids = media.map((item) => item.id);
  const usageCounts = new Map(ids.map((id, index) => [id, media[index]._count.propertyMedia + media[index]._count.projectMedia + media[index]._count.floorPlans + media[index]._count.documents + media[index]._count.portfolioDocuments]));
  const addUsage = (id: string | null) => { if (id && usageCounts.has(id)) usageCounts.set(id, (usageCounts.get(id) ?? 0) + 1); };
  if (ids.length) {
    const [agents, projects, developers, communities, content, reports, seo] = await Promise.all([
      db.agent.findMany({ where: { photoMediaId: { in: ids } }, select: { photoMediaId: true } }),
      db.project.findMany({ where: { brochureMediaId: { in: ids } }, select: { brochureMediaId: true } }),
      db.developer.findMany({ where: { logoMediaId: { in: ids } }, select: { logoMediaId: true } }),
      db.community.findMany({ where: { imageMediaId: { in: ids } }, select: { imageMediaId: true } }),
      db.contentEntry.findMany({ where: { OR: [{ coverMediaId: { in: ids } }, { heroImageMediaId: { in: ids } }] }, select: { coverMediaId: true, heroImageMediaId: true } }),
      db.marketReport.findMany({ where: { OR: [{ coverMediaId: { in: ids } }, { fileMediaId: { in: ids } }] }, select: { coverMediaId: true, fileMediaId: true } }),
      db.seoMetadata.findMany({ where: { ogImageMediaId: { in: ids } }, select: { ogImageMediaId: true } }),
    ]);
    agents.forEach((row) => addUsage(row.photoMediaId));
    projects.forEach((row) => addUsage(row.brochureMediaId));
    developers.forEach((row) => addUsage(row.logoMediaId));
    communities.forEach((row) => addUsage(row.imageMediaId));
    content.forEach((row) => { addUsage(row.coverMediaId); addUsage(row.heroImageMediaId); });
    reports.forEach((row) => { addUsage(row.coverMediaId); addUsage(row.fileMediaId); });
    seo.forEach((row) => addUsage(row.ogImageMediaId));
  }
  return NextResponse.json({
    media: media.map((m) => ({
      id: m.id,
      kind: m.kind,
      url: m.url,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      altText: m.altText,
      caption: m.caption,
      isPrivate: false,
      usageCount: usageCounts.get(m.id) ?? 0,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

const metadataSchema = z.object({
  mediaAssetId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  altText: z.string().trim().max(300).nullable(),
  caption: z.string().trim().max(1000).nullable(),
}).strict();

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("media:update");
  const input = metadataSchema.parse(await jsonBody<z.infer<typeof metadataSchema>>(req));
  return NextResponse.json(await updateMediaMetadata(actor, input, clientIp(req)));
});

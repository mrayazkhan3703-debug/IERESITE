import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { storeUpload } from "@/server/media/pipeline";
import { db } from "@/lib/db";
import { z } from "zod";
import { deleteUnusedMedia, updateMediaMetadata } from "@/server/domain/media-command";
import { clientIp } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";

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
    const requestedKind = form.get("kind");
    const kind = ["IMAGE", "LOGO", "FLOOR_PLAN", "DOCUMENT", "BROCHURE"].includes(String(requestedKind)) ? requestedKind as "IMAGE" | "LOGO" | "FLOOR_PLAN" | "DOCUMENT" | "BROCHURE" : undefined;
    const stored = await storeUpload(file, { altText, uploadedBy: user.id, kind });
    return NextResponse.json(stored, { status: 201 });
  },
  { rateLimit: { limit: 60, windowMs: 3600_000, key: "upload" } }
);

export const GET = apiHandler(async (req) => {
  await requirePermission("media:read");
  const url = new URL(req.url);
  if (url.searchParams.get("policy") === "1") {
    const config = getConfig();
    return NextResponse.json({ maxBytes: config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "application/pdf"] });
  }
  const requestedTake = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isInteger(requestedTake) && requestedTake > 0 ? Math.min(requestedTake, 100) : 50;
  const q = url.searchParams.get("q")?.trim();
  const kind = url.searchParams.get("kind") ?? undefined;
  const createdAfter = url.searchParams.get("createdAfter");
  const createdBefore = url.searchParams.get("createdBefore");
  const minWidth = Number(url.searchParams.get("minWidth"));
  const minHeight = Number(url.searchParams.get("minHeight"));
  const uploader = url.searchParams.get("uploader")?.trim();
  const media = await db.mediaAsset.findMany({
    where: {
      isPrivate: false,
      ...(q ? { OR: [{ altText: { contains: q, mode: "insensitive" as const } }, { caption: { contains: q, mode: "insensitive" as const } }, { mimeType: { contains: q, mode: "insensitive" as const } }, { storageKey: { contains: q, mode: "insensitive" as const } }, { id: { contains: q, mode: "insensitive" as const } }] } : {}),
      ...(kind ? { kind } : {}),
      ...(createdAfter || createdBefore ? { createdAt: { ...(createdAfter && Number.isFinite(Date.parse(createdAfter)) ? { gte: new Date(createdAfter) } : {}), ...(createdBefore && Number.isFinite(Date.parse(createdBefore)) ? { lte: new Date(createdBefore) } : {}) } } : {}),
      ...(Number.isInteger(minWidth) && minWidth > 0 ? { width: { gte: minWidth } } : {}),
      ...(Number.isInteger(minHeight) && minHeight > 0 ? { height: { gte: minHeight } } : {}),
      ...(uploader ? { uploadedBy: uploader } : {}),
    },
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
  const result = media.map((m) => ({
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
      checksum: m.checksum,
      variants: m.variantsJson ? (() => { try { return JSON.parse(m.variantsJson) as Record<string, string>; } catch { return {}; } })() : {},
      uploadedBy: m.uploadedBy,
    }));
  const usageFilter = url.searchParams.get("usage");
  const filtered = usageFilter === "orphaned" ? result.filter((asset) => asset.usageCount === 0)
    : usageFilter === "used" ? result.filter((asset) => asset.usageCount > 0) : result;
  return NextResponse.json({ media: filtered });
});

const deleteSchema = z.object({ mediaAssetIds: z.array(z.string().min(1)).min(1).max(50) }).strict();

/** Bulk delete is intentionally limited to unreferenced assets; each result is reported independently. */
export const DELETE = apiHandler(async (req) => {
  const actor = await requirePermission("media:delete");
  const input = deleteSchema.parse(await jsonBody<z.infer<typeof deleteSchema>>(req));
  const mediaAssetIds = [...new Set(input.mediaAssetIds)];
  const results = await Promise.all(mediaAssetIds.map(async (id) => {
    try { return { id, ...(await deleteUnusedMedia(actor, id, clientIp(req))) }; }
    catch (error) { return { id, error: error instanceof Error ? error.message : "Could not delete this asset." }; }
  }));
  return NextResponse.json({ results, deleted: results.filter((result) => !("error" in result)).length, blocked: results.filter((result) => "error" in result).length }, { status: results.some((result) => "error" in result) ? 207 : 200 });
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

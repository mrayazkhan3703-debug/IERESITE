import { NextResponse } from "next/server";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requirePermission } from "@/server/auth";
import { storeUpload, DuplicateMediaError } from "@/server/media/pipeline";
import { MEDIA_MIME_TYPES, type MediaMode } from "@/lib/media-contract";
import { db } from "@/lib/db";
import { z } from "zod";
import { deleteUnusedMedia, updateMediaMetadata } from "@/server/domain/media-command";
import { clientIp } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";
import { canManageCatalogResource } from "@/server/domain/resource-policy";
import { retainedMediaUsage } from "@/server/media/retained-usage";

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
    const kind = ["IMAGE", "LOGO", "FLOOR_PLAN", "DOCUMENT", "BROCHURE", "VIDEO"].includes(String(requestedKind)) ? requestedKind as "IMAGE" | "LOGO" | "FLOOR_PLAN" | "DOCUMENT" | "BROCHURE" | "VIDEO" : undefined;
    try {
      const stored = await storeUpload(file, { altText, uploadedBy: user.id, kind });
      return NextResponse.json(stored, { status: 201 });
    } catch (error) {
      if (error instanceof DuplicateMediaError) return NextResponse.json({ error: error.message, code: "DUPLICATE_MEDIA", existingAsset: error.existingAsset }, { status: 409 });
      throw error;
    }
  },
  { rateLimit: { limit: 60, windowMs: 3600_000, key: "upload" } }
);

export const GET = apiHandler(async (req) => {
  const user = await requirePermission("media:read");
  const url = new URL(req.url);
  if (url.searchParams.get("policy") === "1") {
    const config = getConfig();
    return NextResponse.json({ maxBytes: config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024, allowedMimeTypes: MEDIA_MIME_TYPES });
  }
  const requestedTake = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isInteger(requestedTake) && requestedTake > 0 ? Math.min(requestedTake, 100) : 50;
  const q = url.searchParams.get("q")?.trim().slice(0, 200);
  const kind = url.searchParams.get("kind") ?? undefined;
  const createdAfter = url.searchParams.get("createdAfter");
  const createdBefore = url.searchParams.get("createdBefore");
  const minWidth = Number(url.searchParams.get("minWidth"));
  const minHeight = Number(url.searchParams.get("minHeight"));
  const uploader = url.searchParams.get("uploader")?.trim();
  const mode = url.searchParams.get("mode") as MediaMode | null;
  const mimeTypes = mode ? MEDIA_MIME_TYPES.filter((mime) => {
    if (mode === "document") return mime === "application/pdf";
    if (mode === "video") return mime.startsWith("video/");
    if (mode === "floor-plan" || mode === "image-or-document") return !mime.startsWith("video/");
    if (mode === "gallery" || mode === "image-or-video") return mime !== "application/pdf";
    return mime.startsWith("image/");
  }) : null;
  const cursor = url.searchParams.get("cursor")?.slice(0, 100);
  const media = await db.mediaAsset.findMany({
    where: {
      isPrivate: false,
      ...(mimeTypes ? { mimeType: { in: [...mimeTypes] } } : {}),
      ...(q ? { OR: [{ originalFilename: { contains: q, mode: "insensitive" as const } }, { altText: { contains: q, mode: "insensitive" as const } }, { caption: { contains: q, mode: "insensitive" as const } }, { mimeType: { contains: q, mode: "insensitive" as const } }, { storageKey: { contains: q, mode: "insensitive" as const } }, { id: { contains: q, mode: "insensitive" as const } }] } : {}),
      ...(kind ? { kind } : {}),
      ...(createdAfter || createdBefore ? { createdAt: { ...(createdAfter && Number.isFinite(Date.parse(createdAfter)) ? { gte: new Date(createdAfter) } : {}), ...(createdBefore && Number.isFinite(Date.parse(createdBefore)) ? { lte: new Date(createdBefore) } : {}) } } : {}),
      ...(Number.isInteger(minWidth) && minWidth > 0 ? { width: { gte: minWidth } } : {}),
      ...(Number.isInteger(minHeight) && minHeight > 0 ? { height: { gte: minHeight } } : {}),
      ...(uploader ? { uploadedBy: uploader } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
    include: { poster: { select: { url: true } }, _count: { select: { propertyMedia: true, projectMedia: true, floorPlans: true, documents: true, portfolioDocuments: true } } },
  });
  const hasNext = media.length > take;
  if (hasNext) media.pop();
  const ids = media.map((item) => item.id);
  const usageCounts = new Map(ids.map((id, index) => [id, media[index]._count.propertyMedia + media[index]._count.projectMedia + media[index]._count.floorPlans + media[index]._count.documents + media[index]._count.portfolioDocuments]));
  const usageGraph = new Map(ids.map((id) => [id, [] as { type: string; id: string; label: string; href: string | null }[]]));
  const addUsage = (id: string | null, detail?: { type: string; id: string; label: string; href: string | null }, countUsage = true) => {
    if (!id || !usageCounts.has(id)) return;
    if (countUsage) usageCounts.set(id, (usageCounts.get(id) ?? 0) + 1);
    if (detail) usageGraph.get(id)?.push(detail);
  };
  if (ids.length) {
    const [properties, propertyFloorPlans, propertyDocuments, projectMedia, agents, projects, developers, communities, content, reports, seo] = await Promise.all([
      db.propertyMedia.findMany({ where: { mediaId: { in: ids } }, select: { mediaId: true, property: { select: { id: true, slug: true, title: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true } } }, take: 1000 }),
      db.propertyFloorPlan.findMany({ where: { mediaId: { in: ids } }, select: { mediaId: true, property: { select: { id: true, slug: true, title: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true } }, bedrooms: true, label: true }, take: 1000 }),
      db.propertyDocument.findMany({ where: { mediaId: { in: ids } }, select: { mediaId: true, docType: true, label: true, property: { select: { id: true, slug: true, title: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true } }, project: { select: { id: true, slug: true, name: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true } } }, take: 1000 }),
      db.projectMedia.findMany({ where: { mediaId: { in: ids } }, select: { mediaId: true, project: { select: { id: true, slug: true, name: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true } }, section: true }, take: 1000 }),
      db.agent.findMany({ where: { photoMediaId: { in: ids } }, select: { id: true, slug: true, name: true, active: true, publicAdvisor: true, photoMediaId: true } }),
      db.project.findMany({ where: { brochureMediaId: { in: ids } }, select: { id: true, slug: true, name: true, publicationStatus: true, deletedAt: true, ownerOrganizationId: true, brochureMediaId: true } }),
      db.developer.findMany({ where: { logoMediaId: { in: ids } }, select: { id: true, slug: true, name: true, logoMediaId: true, projects: { where: { publicationStatus: "PUBLISHED", deletedAt: null }, select: { id: true }, take: 1 } } }),
      db.community.findMany({ where: { imageMediaId: { in: ids } }, select: { id: true, slug: true, name: true, publicationStatus: true, imageMediaId: true } }),
      db.contentEntry.findMany({ where: { OR: [{ coverMediaId: { in: ids } }, { heroImageMediaId: { in: ids } }] }, select: { id: true, slug: true, title: true, contentType: true, status: true, coverMediaId: true, heroImageMediaId: true } }),
      db.marketReport.findMany({ where: { OR: [{ coverMediaId: { in: ids } }, { fileMediaId: { in: ids } }] }, select: { id: true, slug: true, title: true, status: true, coverMediaId: true, fileMediaId: true } }),
      db.seoMetadata.findMany({ where: { ogImageMediaId: { in: ids } }, select: { routeKey: true, ogImageMediaId: true } }),
    ]);
    properties.forEach((row) => {
      const property = row.property;
      const visible = property.deletedAt === null && (property.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, property.ownerOrganizationId));
      addUsage(row.mediaId, visible ? { type: "PROPERTY_GALLERY", id: property.id, label: property.title, href: `/properties/${property.slug}` } : undefined, false);
    });
    propertyFloorPlans.forEach((row) => {
      const property = row.property;
      const visible = property.deletedAt === null && (property.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, property.ownerOrganizationId));
      addUsage(row.mediaId, visible ? { type: "PROPERTY_FLOOR_PLAN", id: property.id, label: `${row.label ?? "Floor plan"}${row.bedrooms === null ? "" : ` · ${row.bedrooms} bedrooms`} · ${property.title}`, href: `/properties/${property.slug}` } : undefined, false);
    });
    propertyDocuments.forEach((row) => {
      const entity = row.property && row.property.deletedAt === null && (row.property.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, row.property.ownerOrganizationId))
        ? { id: row.property.id, title: row.property.title, href: `/properties/${row.property.slug}`, type: "PROPERTY_DOCUMENT" }
        : row.project && row.project.deletedAt === null && (row.project.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, row.project.ownerOrganizationId))
          ? { id: row.project.id, title: row.project.name, href: `/projects/${row.project.slug}`, type: "PROJECT_DOCUMENT" } : null;
      if (entity) addUsage(row.mediaId, { type: entity.type, id: entity.id, label: `${row.label ?? row.docType} · ${entity.title}`, href: entity.href }, false);
    });
    projectMedia.forEach((row) => {
      const project = row.project;
      const visible = project.deletedAt === null && (project.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, project.ownerOrganizationId));
      addUsage(row.mediaId, visible ? { type: `PROJECT_${row.section}`, id: project.id, label: `${row.section.replaceAll("_", " ")} · ${project.name}`, href: `/projects/${project.slug}` } : undefined, false);
    });
    agents.forEach((row) => addUsage(row.photoMediaId, row.active && row.publicAdvisor ? { type: "ADVISOR_PHOTO", id: row.id, label: row.name, href: `/agents/${row.slug}` } : undefined));
    projects.forEach((row) => addUsage(row.brochureMediaId, row.deletedAt === null && (row.publicationStatus === "PUBLISHED" || canManageCatalogResource(user, row.ownerOrganizationId)) ? { type: "PROJECT_BROCHURE", id: row.id, label: `${row.name} brochure`, href: `/projects/${row.slug}` } : undefined));
    developers.forEach((row) => addUsage(row.logoMediaId, row.projects.length ? { type: "DEVELOPER_LOGO", id: row.id, label: row.name, href: `/developers/${row.slug}` } : undefined));
    communities.forEach((row) => addUsage(row.imageMediaId, row.publicationStatus === "PUBLISHED" ? { type: "COMMUNITY_COVER", id: row.id, label: row.name, href: `/communities/${row.slug}` } : undefined));
    content.forEach((row) => {
      const href = row.contentType === "ARTICLE" ? `/insights/${row.slug}`
        : row.contentType === "GUIDE" || row.contentType === "AREA_GUIDE" ? `/guides/${row.slug}` : null;
      addUsage(row.coverMediaId, row.status === "PUBLISHED" ? { type: "CONTENT_COVER", id: row.id, label: row.title, href } : undefined);
      addUsage(row.heroImageMediaId, row.status === "PUBLISHED" ? { type: "CONTENT_HERO", id: row.id, label: row.title, href } : undefined);
    });
    reports.forEach((row) => {
      const href = `/market/reports/${row.slug}`;
      addUsage(row.coverMediaId, row.status === "PUBLISHED" ? { type: "REPORT_COVER", id: row.id, label: row.title, href } : undefined);
      addUsage(row.fileMediaId, row.status === "PUBLISHED" ? { type: "REPORT_FILE", id: row.id, label: row.title, href } : undefined);
    });
    seo.forEach((row) => addUsage(row.ogImageMediaId, { type: "SEO_OPEN_GRAPH", id: row.routeKey, label: row.routeKey, href: `/${row.routeKey}` }));
  }
  const retained = await retainedMediaUsage(db, ids);
  for (const id of ids) {
    for (const use of retained.uses.get(id) ?? []) addUsage(id, use);
    if (retained.truncated && (usageCounts.get(id) ?? 0) === 0) addUsage(id, { type: "USAGE_SCAN_LIMIT", id, label: "Usage scan reached its display limit; deletion still checks all references.", href: null });
  }
  const result = media.map((m) => ({
      id: m.id,
      kind: m.kind,
      originalFilename: m.originalFilename,
      url: m.url,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      altText: m.altText,
      caption: m.caption,
      posterMediaId: m.posterMediaId,
      posterUrl: m.poster?.url ?? null,
      isPrivate: false,
      usageCount: usageCounts.get(m.id) ?? 0,
      usageGraph: usageGraph.get(m.id) ?? [],
      usageGraphTruncated: retained.truncated || (usageCounts.get(m.id) ?? 0) > (usageGraph.get(m.id)?.length ?? 0) || (usageGraph.get(m.id)?.length ?? 0) > 20,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      checksum: m.checksum,
      variants: m.variantsJson ? (() => { try { return JSON.parse(m.variantsJson) as Record<string, string>; } catch { return {}; } })() : {},
      uploadedBy: m.uploadedBy,
    }));
  const usageFilter = url.searchParams.get("usage");
  const filtered = usageFilter === "orphaned" ? result.filter((asset) => asset.usageCount === 0)
    : usageFilter === "used" ? result.filter((asset) => asset.usageCount > 0) : result;
  return NextResponse.json({ media: filtered, nextCursor: hasNext ? media.at(-1)?.id ?? null : null });
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
  posterMediaId: z.string().min(1).nullable().optional(),
}).strict();

export const PATCH = apiHandler(async (req) => {
  const actor = await requirePermission("media:update");
  const input = metadataSchema.parse(await jsonBody<z.infer<typeof metadataSchema>>(req));
  return NextResponse.json(await updateMediaMetadata(actor, input, clientIp(req)));
});

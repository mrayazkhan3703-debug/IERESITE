import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { db } from "@/lib/db";
import { getProjectDetailV2 } from "@/server/domain/read-models";
import { PUBLIC_PROJECT_WHERE } from "@/server/domain/visibility";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const detail = await getProjectDetailV2(slug);
    if (!detail) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(detail);
  }

  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const community = url.searchParams.get("community");
  const developer = url.searchParams.get("developer");
  const handoverFrom = Number(url.searchParams.get("handoverFrom")) || undefined;
  const handoverTo = Number(url.searchParams.get("handoverTo")) || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 24), 48);

  // V2 (U04 §12.1 Projects mode) — additive list filters. All optional; the
  // unfiltered query keeps its exact previous shape (plus lat/lng fields).
  // `community` accepts a comma list (multi-select in the projects filter panel).
  const communitySlugs = community ? community.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const where = {
    ...PUBLIC_PROJECT_WHERE,
    ...(status ? { status: status.toUpperCase() } : {}),
    ...(communitySlugs.length ? { community: { slug: { in: communitySlugs } } } : {}),
    ...(developer ? { developer: { slug: developer.split(",").filter(Boolean)[0] } } : {}),
    ...(handoverFrom || handoverTo
      ? {
          handoverDate: {
            ...(handoverFrom ? { gte: new Date(Date.UTC(handoverFrom, 0, 1)) } : {}),
            ...(handoverTo ? { lte: new Date(Date.UTC(handoverTo, 11, 31, 23, 59, 59)) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { tagline: { contains: q } },
            { developer: { name: { contains: q } } },
            { community: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [projects, total] = await Promise.all([
    db.project.findMany({
      where,
      include: {
        developer: true,
        community: true,
        media: { where: { section: "GALLERY", media: { mimeType: { startsWith: "image/" } } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: true }, take: 1 },
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    }),
    db.project.count({ where }),
  ]);

  const units = await db.propertyUnit.groupBy({ by: ["projectId"], where: { projectId: { not: null } }, _count: true });
  const unitCounts = new Map(units.map((u) => [u.projectId, u._count]));

  return NextResponse.json({
    total,
    projects: projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      status: p.status,
      community: { id: p.community.id, name: p.community.name, slug: p.community.slug },
      developer: { id: p.developer.id, name: p.developer.name, slug: p.developer.slug },
      startingPrice: p.startingPriceMinor ? { minor: p.startingPriceMinor.toString(), currency: p.currency } : null,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      completionPercent: p.completionPercent,
      cover: p.media[0] ? { id: p.media[0].media.id, url: p.media[0].media.url, altText: p.media[0].media.altText } : null,
      totalUnits: p.totalUnits ?? unitCounts.get(p.id) ?? null,
      /* V2 (U04/U05) additive: coordinates for map markers in Projects mode. */
      lat: p.lat,
      lng: p.lng,
    })),
  });
});

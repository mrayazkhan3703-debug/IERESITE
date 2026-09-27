import { NextResponse } from "next/server";
import { apiHandler } from "@/server/api-handler";
import { search } from "@/server/search/service";
import { queryToSearchState } from "@/server/search/types";
import { db } from "@/lib/db";
import { PUBLIC_COMMUNITY_WHERE, PUBLIC_PROJECT_WHERE } from "@/server/domain/visibility";
import { getConfig } from "@/lib/config";
import { mapClustersPostgres } from "@/server/search/postgres-provider";

export const dynamic = "force-dynamic";

/** Map view: bounding-box search + community markers + project markers (V2 §13). */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;

  const bboxParam = query.bbox;
  const state = queryToSearchState({ ...query, page: "1", pageSize: "48" });
  const zoomValue = Number(query.zoom ?? query.z ?? 11);
  const zoom = Number.isFinite(zoomValue) ? Math.min(19, Math.max(3, zoomValue)) : 11;
  if (bboxParam) {
    const parts = bboxParam.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      state.bbox = [parts[0], parts[1], parts[2], parts[3]] as [number, number, number, number];
    }
  }

  const [result, aggregation] = await Promise.all([
    search(state),
    getConfig().SEARCH_PROVIDER === "postgres" ? mapClustersPostgres(state, zoom) : Promise.resolve(null),
  ]);

  const [communities, projectRows] = await Promise.all([
    db.community.findMany({
      where: {
        ...PUBLIC_COMMUNITY_WHERE,
        ...(state.bbox
          ? { AND: [{ lat: { gte: state.bbox[1], lte: state.bbox[3] } }, { lng: { gte: state.bbox[0], lte: state.bbox[2] } }] }
          : {}),
      },
      select: { id: true, name: true, slug: true, lat: true, lng: true, radiusMeters: true },
    }),
    /* V2 (U05 §13): project markers — published projects, bbox-filtered when a
       viewport is given, with the fields the project preview card needs. */
    db.project.findMany({
      where: {
        ...PUBLIC_PROJECT_WHERE,
        ...(state.bbox
          ? {
              AND: [
                { lat: { gte: state.bbox[1], lte: state.bbox[3] } },
                { lng: { gte: state.bbox[0], lte: state.bbox[2] } },
              ],
            }
          : {}),
      },
      include: { developer: { select: { id: true, name: true, slug: true } }, community: { select: { id: true, name: true, slug: true } } },
      take: 96,
    }),
  ]);

  return NextResponse.json({
    results: result.results,
    total: aggregation?.total ?? result.total,
    clusters: aggregation?.clusters ?? result.results.map((item) => ({
      lat: item.lat,
      lng: item.lng,
      count: 1,
      listingId: item.id,
      slug: item.slug,
      title: item.title,
      priceMinor: item.price.minor,
      currency: item.price.currency,
    })),
    communities,
    projects: projectRows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      lat: p.lat,
      lng: p.lng,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      completionPercent: p.completionPercent,
      startingPrice: p.startingPriceMinor ? { minor: p.startingPriceMinor.toString(), currency: p.currency } : null,
      totalUnits: p.totalUnits,
      developer: { id: p.developer.id, name: p.developer.name, slug: p.developer.slug },
      community: { id: p.community.id, name: p.community.name, slug: p.community.slug },
    })),
    tookMs: result.tookMs,
  });
});

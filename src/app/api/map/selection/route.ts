import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { HttpError } from "@/server/auth";
import { publicMapListing } from "@/server/search/service";
import { db } from "@/lib/db";
import { PUBLIC_PROJECT_WHERE } from "@/server/domain/visibility";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  const query = new URL(req.url).searchParams;
  const slug = z.string().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(query.get("slug"));
  if (query.get("kind") === "project") {
    const p = await db.project.findFirst({ where: { ...PUBLIC_PROJECT_WHERE, slug }, include: { developer: { select: { id: true, name: true, slug: true } }, community: { select: { id: true, name: true, slug: true } } } });
    if (!p) throw new HttpError(404, "Public project not found.");
    return NextResponse.json({ project: { id: p.id, slug: p.slug, name: p.name, status: p.status, lat: p.lat, lng: p.lng, handoverDate: p.handoverDate?.toISOString() ?? null, completionPercent: p.completionPercent, startingPrice: p.startingPriceMinor ? { minor: p.startingPriceMinor.toString(), currency: p.currency } : null, totalUnits: p.totalUnits, developer: p.developer, community: p.community } });
  }
  const listing = await publicMapListing(slug);
  if (!listing) throw new HttpError(404, "Public listing not found.");
  return NextResponse.json({ listing });
});

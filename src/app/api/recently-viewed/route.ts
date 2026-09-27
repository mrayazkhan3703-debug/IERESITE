import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { PUBLIC_PROPERTY_WHERE } from "@/server/domain/visibility";

export const dynamic = "force-dynamic";

const schema = z.object({ propertySlug: z.string().max(200) });

export const GET = apiHandler(async () => {
  const user = await requireUser();
  const recent = await db.recentlyViewed.findMany({
    where: { userId: user.id, property: { is: PUBLIC_PROPERTY_WHERE } },
    orderBy: { viewedAt: "desc" },
    take: 12,
    select: { property: { select: { slug: true, title: true } }, viewedAt: true },
  });
  return NextResponse.json({
    recentlyViewed: recent.map((r) => ({ slug: r.property.slug, title: r.property.title, viewedAt: r.viewedAt.toISOString() })),
  });
});

export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const body = await jsonBody<z.infer<typeof schema>>(req);
  const { propertySlug } = schema.parse(body);
  const property = await db.property.findFirst({ where: { slug: propertySlug, ...PUBLIC_PROPERTY_WHERE } });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  await db.recentlyViewed.upsert({
    where: { userId_propertyId: { userId: user.id, propertyId: property.id } },
    create: { userId: user.id, propertyId: property.id },
    update: { viewedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = apiHandler(async () => {
  const user = await requireUser();
  const removed = await db.recentlyViewed.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ cleared: removed.count });
});

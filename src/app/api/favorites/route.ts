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
  const favorites = await db.favorite.findMany({
    where: { userId: user.id, property: { is: PUBLIC_PROPERTY_WHERE } },
    orderBy: { createdAt: "desc" },
    include: {
      property: {
        include: {
          community: true,
          listings: { orderBy: { createdAt: "desc" } },
          media: { orderBy: [{ sortOrder: "asc" }, { isCover: "desc" }], include: { media: true }, take: 1 },
        },
      },
    },
  });
  return NextResponse.json({
    favorites: favorites.map((f) => ({
      slug: f.property.slug,
      title: f.property.title,
      savedAt: f.createdAt.toISOString(),
    })),
  });
});

export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const body = await jsonBody<z.infer<typeof schema>>(req);
  const { propertySlug } = schema.parse(body);
  const property = await db.property.findFirst({ where: { slug: propertySlug, ...PUBLIC_PROPERTY_WHERE } });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  const existing = await db.favorite.findUnique({
    where: { userId_propertyId: { userId: user.id, propertyId: property.id } },
  });
  if (existing) {
    await db.favorite.delete({ where: { id: existing.id } });
    return NextResponse.json({ saved: false });
  }
  await db.favorite.create({ data: { userId: user.id, propertyId: property.id } });
  return NextResponse.json({ saved: true });
});

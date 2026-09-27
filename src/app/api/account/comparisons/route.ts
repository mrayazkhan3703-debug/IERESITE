import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/api-handler";
import { audit, requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { PUBLIC_PROPERTY_WHERE } from "@/server/domain/visibility";

const schema = z.object({
  name: z.string().max(120).optional(),
  propertySlugs: z.array(z.string().max(200)).max(4).transform((values) => [...new Set(values)]),
});

export const GET = apiHandler(async () => {
  const user = await requireUser();
  const comparison = await db.comparison.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        where: { property: { is: PUBLIC_PROPERTY_WHERE } },
        orderBy: { sortOrder: "asc" },
        include: { property: { select: { slug: true, title: true } } },
      },
    },
  });
  return NextResponse.json({
    comparison: comparison
      ? { id: comparison.id, name: comparison.name, properties: comparison.items.map((item) => item.property) }
      : null,
  });
});

export const PUT = apiHandler(async (req) => {
  const user = await requireUser();
  const input = schema.parse(await jsonBody(req));
  const properties = await db.property.findMany({
    where: { slug: { in: input.propertySlugs }, ...PUBLIC_PROPERTY_WHERE },
    select: { id: true, slug: true },
  });
  if (properties.length !== input.propertySlugs.length) {
    return NextResponse.json({ error: "One or more properties are unavailable", code: "INVALID_PROPERTY" }, { status: 400 });
  }
  const bySlug = new Map(properties.map((property) => [property.slug, property.id]));
  const comparison = await db.$transaction(async (tx) => {
    let record = await tx.comparison.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
    if (!record) record = await tx.comparison.create({ data: { userId: user.id, name: input.name ?? "Saved comparison" } });
    else if (input.name !== undefined) record = await tx.comparison.update({ where: { id: record.id }, data: { name: input.name } });
    await tx.comparisonItem.deleteMany({ where: { comparisonId: record.id } });
    if (input.propertySlugs.length) {
      await tx.comparisonItem.createMany({
        data: input.propertySlugs.map((slug, sortOrder) => ({ comparisonId: record!.id, propertyId: bySlug.get(slug)!, sortOrder })),
      });
    }
    await audit({ actorType: "USER", actorId: user.id, action: "comparison.replaced", resourceType: "comparison", resourceId: record.id, after: { propertySlugs: input.propertySlugs } }, tx);
    return record;
  });
  return NextResponse.json({ id: comparison.id, propertySlugs: input.propertySlugs });
});

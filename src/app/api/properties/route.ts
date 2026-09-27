import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/api-handler";
import { search } from "@/server/search/service";
import { searchStateSchema } from "@/server/search/types";
import { db } from "@/lib/db";
import { audit, requirePermission } from "@/server/auth";
import { emitEvent } from "@/server/jobs/outbox";
import { clientIp } from "@/server/rate-limit";
import { PUBLIC_COMMUNITY_WHERE } from "@/server/domain/visibility";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(["sale", "rent", "short_term"]).optional(),
  community: z.string().optional(),
  propertyType: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  bedsMin: z.coerce.number().optional(),
  offPlan: z.enum(["0", "1"]).optional(),
  featured: z.enum(["0", "1"]).optional(),
  exclusive: z.enum(["0", "1"]).optional(),
  sort: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const q = querySchema.parse(raw);

  /* U21 fix: NL search chips carry community display names ("Dubai Marina")
   * while the search index filters on slugs — without this resolution the
   * hero sentence search silently returned 0 results. Accept slug or name. */
  let communities: string[] | undefined;
  if (q.community) {
    const wanted = q.community.split(",").map((c) => c.trim()).filter(Boolean);
    if (wanted.length) {
      const rows = await db.community.findMany({
        where: { ...PUBLIC_COMMUNITY_WHERE, OR: wanted.flatMap((w) => [{ slug: w }, { name: w }]) },
        select: { slug: true, name: true },
      });
      const bySlug = new Map(rows.map((r) => [r.slug.toLowerCase(), r.slug]));
      const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.slug]));
      communities = wanted.map((w) => bySlug.get(w.toLowerCase()) ?? byName.get(w.toLowerCase()) ?? w);
    }
  }

  const state = searchStateSchema.parse({
    q: q.q,
    listingType: (q.type?.toUpperCase() as "SALE" | "RENT" | "SHORT_TERM") ?? "SALE",
    communities,
    propertyTypes: q.propertyType ? q.propertyType.split(",").map((p) => p.toUpperCase()) : undefined,
    priceMin: q.priceMin,
    priceMax: q.priceMax,
    bedroomsMin: q.bedsMin,
    offPlan: q.offPlan === "1" ? true : q.offPlan === "0" ? false : undefined,
    featured: q.featured === "1" ? true : undefined,
    exclusive: q.exclusive === "1" ? true : undefined,
    sort: (q.sort as "relevance") ?? "relevance",
    page: q.page ?? 1,
    pageSize: q.limit ?? 12,
  });

  const result = await search(state);
  return NextResponse.json(result);
});

/** Admin: create property + listing (with outbox indexing event) */
const createSchema = z.object({
  title: z.string().min(5).max(200),
  slug: z.string().min(3).max(200).regex(/^[a-z0-9-]+$/).optional(),
  communitySlug: z.string(),
  projectSlug: z.string().optional(),
  propertyType: z.string().default("APARTMENT"),
  bedrooms: z.number().min(0).max(20),
  bathrooms: z.number().min(0).max(20),
  builtUpAreaSqft: z.number().positive().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z.string().max(5000).optional(),
  listingType: z.enum(["SALE", "RENT"]).default("SALE"),
  priceAed: z.number().positive(),
  offPlan: z.boolean().default(false),
  availabilityStatus: z.string().default("AVAILABLE"),
  agentSlug: z.string().optional(),
  publish: z.boolean().default(false),
});

export const POST = apiHandler(async (req) => {
  const user = await requirePermission("property:create");
  const body = await req.json();
  const input = createSchema.parse(body);

  const community = await db.community.findUnique({ where: { slug: input.communitySlug } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 400 });
  const project = input.projectSlug ? await db.project.findUnique({ where: { slug: input.projectSlug } }) : null;
  const agent = input.agentSlug ? await db.agent.findUnique({ where: { slug: input.agentSlug } }) : null;

  const slug =
    input.slug ??
    `${input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)}-${Math.random().toString(36).slice(2, 6)}`;

  const created = await db.$transaction(async (tx) => {
    const property = await tx.property.create({
      data: {
      title: input.title,
      slug,
      communityId: community.id,
      projectId: project?.id ?? null,
      developerId: project?.developerId ?? null,
      propertyType: input.propertyType.toUpperCase(),
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      builtUpAreaSqft: input.builtUpAreaSqft ?? null,
      lat: input.lat,
      lng: input.lng,
      locationPrecision: "APPROXIMATE",
      locationSourceType: "INTERNAL",
      description: input.description ?? null,
      publicationStatus: input.publish ? "PUBLISHED" : "DRAFT",
      sourceType: "INTERNAL",
      createdBy: user.id,
      },
    });

    const listing = await tx.listing.create({
      data: {
      propertyId: property.id,
      listingType: input.listingType,
      priceMinor: BigInt(Math.round(input.priceAed * 100)),
      currency: "AED",
      offPlan: input.offPlan,
      availabilityStatus: input.availabilityStatus,
      agentId: agent?.id ?? null,
      publishedAt: input.publish ? new Date() : null,
      },
    });

    await tx.priceHistory.create({
      data: { propertyId: property.id, listingId: listing.id, priceMinor: listing.priceMinor, sourceType: "INTERNAL" },
    });

    if (input.publish) {
      await emitEvent("property", property.id, "property.published", { propertyId: property.id }, tx);
    }

    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "property.create",
      resourceType: "property",
      resourceId: property.id,
      after: { ...input, priceAed: input.priceAed },
      ip: clientIp(req),
    }, tx);

    return { propertyId: property.id, listingId: listing.id };
  });

  return NextResponse.json({ ...created, slug }, { status: 201 });
});

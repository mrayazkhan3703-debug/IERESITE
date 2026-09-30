/**
 * Public read models (Q04/Q11/Q12/Q13/Q14): safe projections of canonical
 * entities — drafts/private notes never leak through public queries.
 */
import { db, parseJson } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { MediaDTO, ProjectCardDTO, CommunityCardDTO, AgentDTO, ListingCardDTO } from "@/lib/types";
import {
  PUBLIC_AGENT_WHERE,
  PUBLIC_COMMUNITY_WHERE,
  PUBLIC_DEVELOPER_WHERE,
  PUBLIC_PROJECT_WHERE,
  PUBLIC_PROPERTY_WHERE,
  publicListingWindowWhere,
} from "@/server/domain/visibility";

function mediaDto(m: { id: string; url: string; altText: string | null; caption: string | null; width: number | null; height: number | null; kind: string; mimeType?: string; poster?: { url: string } | null }): MediaDTO {
  return { id: m.id, url: m.url, altText: m.altText, caption: m.caption, width: m.width, height: m.height, kind: m.kind, mimeType: m.mimeType, posterUrl: m.poster?.url ?? null };
}

export interface PropertyDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  shortDescription: string | null;
  highlights: string[];
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  builtUpAreaSqft: number | null;
  plotAreaSqft: number | null;
  furnishing: string | null;
  view: string | null;
  floor: number | null;
  totalFloors: number | null;
  handoverQuarter: string | null;
  reraPermit: string | null;
  lat: number;
  lng: number;
  addressLine: string | null;
  listing: {
    id: string;
    listingType: string;
    priceMinor: string;
    currency: string;
    priceQualifier: string | null;
    rentFrequency: string | null;
    availabilityStatus: string;
    offPlan: boolean;
    isFeatured: boolean;
    isExclusive: boolean;
    serviceChargePerSqft: number | null;
    publishedAt: string | null;
  } | null;
  community: { id: string; name: string; slug: string; summary: string | null; lat: number; lng: number };
  project: { id: string; name: string; slug: string; status: string; handoverDate: string | null; completionPercent: number | null } | null;
  developer: { id: string; name: string; slug: string; verificationStatus: string } | null;
  agent: AgentDTO | null;
  media: MediaDTO[];
  floorPlans: { id: string; label: string | null; bedrooms: number | null; areaSqft: number | null; priceMinor: string | null; media: MediaDTO }[];
  documents: { id: string; label: string | null; docType: string; gated: boolean; url: string }[];
  amenities: { key: string; name: string; category: string }[];
  priceHistory: { priceMinor: string; recordedAt: string; sourceType: string }[];
  paymentPlan: { name: string; totalPercent: number; postHandover: boolean; verificationStatus: string; installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[] } | null;
  similar: ListingCardDTO[];
  isDemoData: boolean;
  sourceType: string;
  sourceUpdatedAt: string | null;
  nearby: { name: string; slug: string; distanceKm: number }[];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function getPropertyDetail(
  slug: string,
  options?: { previewScope: Prisma.PropertyWhereInput },
): Promise<PropertyDetail | null> {
  const property = await db.property.findFirst({
    where: options?.previewScope
      ? { AND: [{ slug, deletedAt: null }, options.previewScope] }
      : { slug, ...PUBLIC_PROPERTY_WHERE },
    include: {
      community: true,
      project: { include: { developer: true, paymentPlans: { where: { verificationStatus: { in: ["PUBLISHED", "VERIFIED"] } }, include: { installments: true }, orderBy: { isDefault: "desc" } } } },
      developer: true,
      media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } } },
      floorPlans: { orderBy: { bedrooms: "asc" }, include: { media: { include: { poster: { select: { url: true } } } } } },
      documents: { include: { media: { include: { poster: { select: { url: true } } } } } },
      amenities: { include: { amenity: true } },
      listings: {
        ...(!options?.previewScope ? { where: publicListingWindowWhere() } : {}),
        orderBy: { createdAt: "desc" },
        include: { agent: true },
      },
      priceHistory: { orderBy: { recordedAt: "desc" }, take: 12 },
    },
  });
  if (!property) return null;

  const listing = property.listings[0] ?? null;
  const agent = listing?.agent?.active && listing.agent.publicAdvisor ? listing.agent : null;

  const plan = property.project?.paymentPlans[0] ?? null;

  // similar: same community (fallback: same type), exclude self
  const similarProps = await db.property.findMany({
    where: {
      id: { not: property.id },
      ...PUBLIC_PROPERTY_WHERE,
      OR: [{ communityId: property.communityId }, { propertyType: property.propertyType }],
      listings: { some: { ...publicListingWindowWhere(), listingType: listing?.listingType ?? "SALE" } },
    },
    include: {
      community: true,
      project: { include: { developer: true } },
      developer: true,
      listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" } },
      media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
    },
    take: 6,
  });

  const similar: ListingCardDTO[] = similarProps
    .filter((p) => p.listings[0])
    .map((p) => {
      const l = p.listings[0];
      const cover = p.media[0]?.media;
      return {
        id: l.id,
        slug: p.slug,
        title: p.title,
        propertyType: p.propertyType,
        listingType: l.listingType as ListingCardDTO["listingType"],
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqft: p.builtUpAreaSqft,
        price: { minor: l.priceMinor.toString(), currency: l.currency, qualifier: l.priceQualifier, rentFrequency: l.rentFrequency },
        availabilityStatus: l.availabilityStatus,
        offPlan: l.offPlan,
        isFeatured: l.isFeatured,
        isExclusive: l.isExclusive,
        community: { id: p.community.id, name: p.community.name, slug: p.community.slug },
        project: p.project ? { id: p.project.id, name: p.project.name, slug: p.project.slug } : null,
        developer: p.developer ?? p.project?.developer ? { id: (p.developer ?? p.project!.developer).id, name: (p.developer ?? p.project!.developer).name, slug: (p.developer ?? p.project!.developer).slug } : null,
        agent: null,
        cover: cover ? mediaDto(cover) : null,
        lat: p.lat,
        lng: p.lng,
        handoverQuarter: p.handoverQuarter,
        view: p.view,
        furnishing: p.furnishing,
        isDemoData: p.isDemoData,
      };
    });

  // nearby communities (geo)
  const allCommunities = await db.community.findMany({
    where: { ...PUBLIC_COMMUNITY_WHERE, id: { not: property.communityId } },
    select: { id: true, name: true, slug: true, lat: true, lng: true },
  });
  const nearby = allCommunities
    .map((c) => ({ name: c.name, slug: c.slug, distanceKm: Math.round(haversineKm(property.lat, property.lng, c.lat, c.lng) * 10) / 10 }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 4);

  return {
    id: property.id,
    slug: property.slug,
    title: property.title,
    description: property.description,
    shortDescription: property.shortDescription,
    highlights: parseJson<string[]>(property.highlightsJson, []),
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    builtUpAreaSqft: property.builtUpAreaSqft,
    plotAreaSqft: property.plotAreaSqft,
    furnishing: property.furnishing,
    view: property.view,
    floor: property.floor,
    totalFloors: property.totalFloors,
    handoverQuarter: property.handoverQuarter,
    reraPermit: property.reraPermit,
    lat: property.lat,
    lng: property.lng,
    addressLine: property.addressLine,
    listing: listing
      ? {
          id: listing.id,
          listingType: listing.listingType,
          priceMinor: listing.priceMinor.toString(),
          currency: listing.currency,
          priceQualifier: listing.priceQualifier,
          rentFrequency: listing.rentFrequency,
          availabilityStatus: listing.availabilityStatus,
          offPlan: listing.offPlan,
          isFeatured: listing.isFeatured,
          isExclusive: listing.isExclusive,
          serviceChargePerSqft: listing.serviceChargePerSqft,
          publishedAt: listing.publishedAt?.toISOString() ?? null,
        }
      : null,
    community: {
      id: property.community.id,
      name: property.community.name,
      slug: property.community.slug,
      summary: property.community.summary,
      lat: property.community.lat,
      lng: property.community.lng,
    },
    project: property.project
      ? {
          id: property.project.id,
          name: property.project.name,
          slug: property.project.slug,
          status: property.project.status,
          handoverDate: property.project.handoverDate?.toISOString() ?? null,
          completionPercent: property.project.completionPercent,
        }
      : null,
    developer: (property.developer ?? property.project?.developer)
      ? {
          id: (property.developer ?? property.project!.developer)!.id,
          name: (property.developer ?? property.project!.developer)!.name,
          slug: (property.developer ?? property.project!.developer)!.slug,
          verificationStatus: (property.developer ?? property.project!.developer)!.verificationStatus,
        }
      : null,
    agent: agent
      ? {
          id: agent.id,
          slug: agent.slug,
          name: agent.name,
          jobTitle: agent.jobTitle,
          bio: agent.bio,
          phoneE164: agent.phoneE164,
          whatsappE164: agent.whatsappE164,
          email: agent.email,
          photo: null,
          languages: parseJson<{ code: string; name: string; fluency: string }[]>(agent.languagesJson, []),
          specialties: parseJson<string[]>(agent.specialtiesJson, []),
          communities: [],
          yearsExperience: agent.yearsExperience,
          active: agent.active,
          leadCapacityState: agent.leadCapacityState,
          /* V3-02 verified-team fields (additive) */
          department: agent.department,
          publicAdvisor: agent.publicAdvisor,
          phoneDisplay: agent.phoneDisplay,
          photoUrl: agent.photoUrl,
        }
      : null,
    media: property.media.map((m) => mediaDto({ ...m.media, altText: m.altText ?? m.media.altText, caption: m.caption ?? m.media.caption })),
    floorPlans: property.floorPlans.map((fp) => ({
      id: fp.id,
      label: fp.label,
      bedrooms: fp.bedrooms,
      areaSqft: fp.areaSqft,
      priceMinor: fp.priceMinor?.toString() ?? null,
      media: mediaDto(fp.media),
    })),
    documents: property.documents.map((d) => ({ id: d.id, label: d.label, docType: d.docType, gated: d.gated, url: d.gated ? "" : d.media.url })),
    amenities: property.amenities.map((a) => ({ key: a.amenity.key, name: a.amenity.name, category: a.amenity.category })),
    priceHistory: property.priceHistory.map((ph) => ({ priceMinor: ph.priceMinor.toString(), recordedAt: ph.recordedAt.toISOString(), sourceType: ph.sourceType })),
    paymentPlan: plan
      ? {
          name: plan.name,
          totalPercent: plan.totalPercent,
          postHandover: plan.postHandover,
          verificationStatus: plan.verificationStatus,
          installments: plan.installments
            .sort((a, b) => a.sequence - b.sequence)
            .map((i) => ({ sequence: i.sequence, label: i.label, percent: i.percent, dueOffsetMonths: i.dueOffsetMonths })),
        }
      : null,
    similar,
    isDemoData: property.isDemoData,
    sourceType: property.sourceType,
    sourceUpdatedAt: property.sourceUpdatedAt?.toISOString() ?? null,
    nearby,
  };
}

/* Property detail V2 (U06 §14.2/§53) — additive wrapper: base detail + record-level
 * freshness fields for the "last verified / refreshed" line. Never modifies the
 * base projection above (signature and shape unchanged). */
export interface PropertyDetailV2 extends PropertyDetail {
  /** Public listing reference (canonical human-readable ref = property slug). */
  listingRef: string;
  /** Property record last refresh timestamp (any content update). */
  updatedAt: string;
  /** Listing record last update (price/status changes), null when no listing. */
  listingUpdatedAt: string | null;
}

export async function getPropertyDetailV2(
  slug: string,
  options?: { previewScope: Prisma.PropertyWhereInput },
): Promise<PropertyDetailV2 | null> {
  const base = await getPropertyDetail(slug, options);
  if (!base) return null;
  const property = await db.property.findUnique({
    where: { id: base.id },
    select: { updatedAt: true },
  });
  const listing = await db.listing.findFirst({
    where: { id: base.listing?.id },
    select: { updatedAt: true },
  });
  return {
    ...base,
    listingRef: base.slug,
    updatedAt: (property?.updatedAt ?? new Date()).toISOString(),
    listingUpdatedAt: listing?.updatedAt.toISOString() ?? null,
  };
}

/* Projects -------------------------------------------------------------------- */

export async function getProjectDetail(slug: string) {
  const project = await db.project.findFirst({
    where: { slug, ...PUBLIC_PROJECT_WHERE },
    include: {
      developer: true,
      community: true,
      media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } } },
      amenities: { include: { amenity: true } },
      paymentPlans: { where: { verificationStatus: { in: ["PUBLISHED", "VERIFIED"] } }, include: { installments: true }, orderBy: { isDefault: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 6 },
      documents: { include: { media: { include: { poster: { select: { url: true } } } } } },
    },
  });
  if (!project) return null;

  const units = await db.propertyUnit.findMany({
    where: { projectId: project.id },
    orderBy: [{ bedrooms: "asc" }, { areaSqft: "asc" }],
  });

  const availableProperties = await db.property.findMany({
    where: { projectId: project.id, ...PUBLIC_PROPERTY_WHERE },
    include: {
      community: true,
      listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" } },
      media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
    },
    take: 12,
  });

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    tagline: project.tagline,
    summary: project.summary,
    description: project.description,
    status: project.status,
    projectType: project.projectType,
    launchDate: project.launchDate?.toISOString() ?? null,
    handoverDate: project.handoverDate?.toISOString() ?? null,
    completionPercent: project.completionPercent,
    constructionStatus: project.constructionStatus,
    constructionSourceUrl: project.constructionSourceUrl,
    constructionSourceVerifiedAt: project.constructionSourceVerifiedAt?.toISOString() ?? null,
    totalUnits: project.totalUnits,
    startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
    currency: project.currency,
    lat: project.lat,
    lng: project.lng,
    highlights: parseJson<string[]>(project.highlightsJson, []),
    keyAmenities: parseJson<string[]>(project.keyAmenitiesJson, []),
    developer: {
      id: project.developer.id,
      name: project.developer.name,
      slug: project.developer.slug,
      summary: project.developer.summary,
      verificationStatus: project.developer.verificationStatus,
      lastVerifiedAt: project.developer.lastVerifiedAt?.toISOString() ?? null,
    },
    community: {
      id: project.community.id,
      name: project.community.name,
      slug: project.community.slug,
      summary: project.community.summary,
      lat: project.community.lat,
      lng: project.community.lng,
    },
    media: project.media.map((m) => mediaDto({ ...m.media, altText: m.altText ?? m.media.altText, caption: m.caption ?? m.media.caption })),
    amenities: project.amenities.map((a) => ({ key: a.amenity.key, name: a.amenity.name })),
    paymentPlans: project.paymentPlans.map((p) => ({
      id: p.id,
      name: p.name,
      totalPercent: p.totalPercent,
      postHandover: p.postHandover,
      verificationStatus: p.verificationStatus,
      isDefault: p.isDefault,
      installments: p.installments
        .sort((a, b) => a.sequence - b.sequence)
        .map((i) => ({ sequence: i.sequence, label: i.label, percent: i.percent, dueOffsetMonths: i.dueOffsetMonths })),
    })),
    documents: project.documents.map((d) => ({ id: d.id, label: d.label, docType: d.docType, gated: d.gated, url: d.gated ? "" : d.media.url })),
    units: units.map((u) => ({
      id: u.id,
      unitNumber: u.unitNumber,
      unitType: u.unitType,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      areaSqft: u.areaSqft,
      priceMinor: u.priceMinor?.toString() ?? null,
      availabilityStatus: u.availabilityStatus,
      floor: u.floor,
    })),
    statusHistory: project.statusHistory.map((h) => ({ toStatus: h.toStatus, reason: h.reason, createdAt: h.createdAt.toISOString() })),
    availableProperties: availableProperties
      .filter((p) => p.listings[0])
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqft: p.builtUpAreaSqft,
        priceMinor: p.listings[0].priceMinor.toString(),
        availabilityStatus: p.listings[0].availabilityStatus,
        cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      })),
    isDemoData: project.isDemoData,
    sourceVerifiedAt: project.sourceVerifiedAt?.toISOString() ?? null,
  };
}

/* Communities / developers / agents ---------------------------------------------- */

export async function listCommunities(): Promise<CommunityCardDTO[]> {
  const communities = await db.community.findMany({
    where: PUBLIC_COMMUNITY_WHERE,
    orderBy: { name: "asc" },
  });
  const counts = await db.property.groupBy({
    by: ["communityId"],
    where: PUBLIC_PROPERTY_WHERE,
    _count: true,
  });
  const countMap = new Map(counts.map((c) => [c.communityId, c._count]));
  // Resolve cover media (imageMediaId is a plain column — batch lookup)
  const mediaIds = communities.map((c) => c.imageMediaId).filter((m): m is string => !!m);
  const media = mediaIds.length ? await db.mediaAsset.findMany({ where: { id: { in: mediaIds }, isPrivate: false, kind: "IMAGE" } }) : [];
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  return communities.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    summary: c.summary,
    areaType: c.areaType,
    listingCount: countMap.get(c.id) ?? 0,
    avgPricePerSqft: c.avgPricePerSqftMinor ? { minor: c.avgPricePerSqftMinor.toString(), currency: c.currency } : null,
    image: c.imageMediaId
      ? (() => {
          const m = mediaMap.get(c.imageMediaId);
          return m ? { id: m.id, url: m.url, altText: m.altText, caption: m.caption, width: m.width, height: m.height, kind: m.kind } : null;
        })()
      : null,
    lat: c.lat,
    lng: c.lng,
    lifestyleTags: parseJson<string[]>(c.lifestyleTagsJson, []),
  }));
}

export async function getCommunityDetail(slug: string) {
  const community = await db.community.findFirst({ where: { slug, ...PUBLIC_COMMUNITY_WHERE } });
  if (!community) return null;

  const [properties, projects, metrics, boundary] = await Promise.all([
    db.property.findMany({
      where: { communityId: community.id, ...PUBLIC_PROPERTY_WHERE },
      include: {
        listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" } },
        media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
        project: { include: { developer: true } },
      },
      take: 9,
    }),
    db.project.findMany({
      where: { communityId: community.id, ...PUBLIC_PROJECT_WHERE },
      include: { developer: true, media: { where: { section: "GALLERY", media: { mimeType: { startsWith: "image/" } } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 } },
      take: 6,
    }),
    db.marketMetric.findMany({
      where: { communityId: community.id },
      orderBy: { periodStart: "desc" },
      take: 60,
    }),
    db.locationBoundary.findUnique({ where: { communityId: community.id } }),
  ]);

  const agents = await db.agentCommunity.findMany({
    where: { communityId: community.id, agent: { is: PUBLIC_AGENT_WHERE } },
    include: { agent: true },
    take: 4,
  });

  const coverMedia = community.imageMediaId ? await db.mediaAsset.findFirst({ where: { id: community.imageMediaId, isPrivate: false, kind: "IMAGE" } }) : null;

  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    summary: community.summary,
    description: community.description,
    areaType: community.areaType,
    lat: community.lat,
    lng: community.lng,
    radiusMeters: community.radiusMeters,
    avgPricePerSqftMinor: community.avgPricePerSqftMinor?.toString() ?? null,
    currency: community.currency,
    lifestyleTags: parseJson<string[]>(community.lifestyleTagsJson, []),
    transport: parseJson<{ type: string; name: string; distance: string }[]>(community.transportJson, []),
    schools: parseJson<{ name: string; rating: string }[]>(community.schoolsJson, []),
    healthcare: parseJson<{ name: string; type: string }[]>(community.healthcareJson, []),
    retail: parseJson<{ name: string; type: string }[]>(community.retailJson, []),
    boundary: boundary ? parseJson<unknown>(boundary.geoJson, null) : null,
    image: coverMedia ? mediaDto(coverMedia) : null,
    properties: properties
      .filter((p) => p.listings[0])
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqft: p.builtUpAreaSqft,
        priceMinor: p.listings[0].priceMinor.toString(),
        listingType: p.listings[0].listingType,
        availabilityStatus: p.listings[0].availabilityStatus,
        cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      })),
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      developerName: p.developer.name,
      startingPriceMinor: p.startingPriceMinor?.toString() ?? null,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      cover: p.media[0] ? mediaDto(p.media[0].media) : null,
    })),
    metrics: metrics.map((m) => ({
      metricKey: m.metricKey,
      periodStart: m.periodStart.toISOString(),
      valueNumeric: m.valueNumeric,
      unit: m.unit,
      sourceName: m.sourceName,
      methodology: m.methodology,
      isIllustrative: m.isIllustrative,
    })),
    agents: agents.map(({ agent }) => ({ slug: agent.slug, name: agent.name, jobTitle: agent.jobTitle, photo: null, photoUrl: agent.photoUrl })),
    isDemoData: community.isDemoData,
  };
}

export async function listDevelopers() {
  const developers = await db.developer.findMany({ where: PUBLIC_DEVELOPER_WHERE, orderBy: { name: "asc" } });
  const [counts, logos] = await Promise.all([
    db.project.groupBy({ by: ["developerId"], where: PUBLIC_PROJECT_WHERE, _count: true }),
    db.mediaAsset.findMany({ where: { id: { in: developers.map((developer) => developer.logoMediaId).filter((id): id is string => !!id) }, isPrivate: false, kind: "IMAGE" } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.developerId, c._count]));
  const logoMap = new Map(logos.map((logo) => [logo.id, mediaDto(logo)]));
  return developers.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    summary: d.summary,
    verificationStatus: d.verificationStatus,
    lastVerifiedAt: d.lastVerifiedAt?.toISOString() ?? null,
    logo: d.logoMediaId ? logoMap.get(d.logoMediaId) ?? null : null,
    projectCount: countMap.get(d.id) ?? 0,
  }));
}

export async function getDeveloperDetail(slug: string) {
  const developer = await db.developer.findFirst({ where: { slug, ...PUBLIC_DEVELOPER_WHERE } });
  if (!developer) return null;
  const projects = await db.project.findMany({
    where: { developerId: developer.id, ...PUBLIC_PROJECT_WHERE },
    include: { community: true, media: { where: { section: "GALLERY", media: { mimeType: { startsWith: "image/" } } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  const logo = developer.logoMediaId
    ? await db.mediaAsset.findFirst({ where: { id: developer.logoMediaId, isPrivate: false, kind: "IMAGE" } })
    : null;
  return {
    id: developer.id,
    slug: developer.slug,
    name: developer.name,
    summary: developer.summary,
    description: developer.description,
    websiteUrl: developer.websiteUrl,
    verificationStatus: developer.verificationStatus,
    lastVerifiedAt: developer.lastVerifiedAt?.toISOString() ?? null,
    foundedYear: developer.foundedYear,
    logo: logo ? mediaDto(logo) : null,
    projects: projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      status: p.status,
      community: { id: p.community.id, name: p.community.name, slug: p.community.slug },
      developer: { id: developer.id, name: developer.name, slug: developer.slug },
      startingPrice: p.startingPriceMinor ? { minor: p.startingPriceMinor.toString(), currency: p.currency } : null,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      completionPercent: p.completionPercent,
      cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      totalUnits: p.totalUnits,
    })),
    isDemoData: developer.isDemoData,
  };
}

export async function listAgents(): Promise<AgentDTO[]> {
  const agents = await db.agent.findMany({
    where: PUBLIC_AGENT_WHERE,
    orderBy: [{ sortWeight: "desc" }, { name: "asc" }],
    include: { user: { select: { id: true } } },
  });
  const listingCounts = await db.listing.groupBy({ by: ["agentId"], where: { agentId: { not: null } }, _count: true });
  const countMap = new Map(listingCounts.map((c) => [c.agentId!, c._count]));
  const photoMap = await resolveAgentPhotos(agents.map((agent) => agent.id));
  return agents.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    jobTitle: a.jobTitle,
    bio: a.bio,
    phoneE164: a.phoneE164,
    whatsappE164: a.whatsappE164,
    email: a.email,
    photo: photoMap.get(a.id) ?? null,
    languages: parseJson<{ code: string; name: string; fluency: string }[]>(a.languagesJson, []),
    specialties: parseJson<string[]>(a.specialtiesJson, []),
    communities: parseJson<{ id: string; name: string; slug: string }[]>(a.communitiesJson, []),
    yearsExperience: a.yearsExperience,
    active: a.active,
    leadCapacityState: a.leadCapacityState,
    listingCount: countMap.get(a.id) ?? 0,
    /* V3-02 verified-team fields (additive) */
    department: a.department,
    publicAdvisor: a.publicAdvisor,
    phoneDisplay: a.phoneDisplay,
    photoUrl: a.photoUrl,
  }));
}

export async function getAgentDetail(slug: string): Promise<(AgentDTO & { listings: ListingCardDTO[] }) | null> {
  const agents = await listAgents();
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) return null;
  const listings = await db.listing.findMany({
    where: { ...publicListingWindowWhere(), agentId: agent.id, property: { is: PUBLIC_PROPERTY_WHERE } },
    include: {
      property: {
        include: {
          community: true,
          project: { include: { developer: true } },
          media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
        },
      },
    },
    take: 9,
  });
  return {
    ...agent,
    listings: listings.map((l) => ({
      id: l.id,
      slug: l.property.slug,
      title: l.property.title,
      propertyType: l.property.propertyType,
      listingType: l.listingType as ListingCardDTO["listingType"],
      bedrooms: l.property.bedrooms,
      bathrooms: l.property.bathrooms,
      areaSqft: l.property.builtUpAreaSqft,
      price: { minor: l.priceMinor.toString(), currency: l.currency, qualifier: l.priceQualifier, rentFrequency: l.rentFrequency },
      availabilityStatus: l.availabilityStatus,
      offPlan: l.offPlan,
      isFeatured: l.isFeatured,
      isExclusive: l.isExclusive,
      community: { id: l.property.community.id, name: l.property.community.name, slug: l.property.community.slug },
      project: l.property.project ? { id: l.property.project.id, name: l.property.project.name, slug: l.property.project.slug } : null,
      developer: null,
      agent: { id: agent.id, name: agent.name, slug: agent.slug, phone: agent.phoneE164 },
      cover: l.property.media[0] ? mediaDto(l.property.media[0].media) : null,
      lat: l.property.lat,
      lng: l.property.lng,
      handoverQuarter: l.property.handoverQuarter,
      view: l.property.view,
      furnishing: l.property.furnishing,
      isDemoData: l.property.isDemoData,
    })),
  };
}

/* ============================================================================
 * Market data-quality validation pipeline (V2 §19.5 + §38).
 *
 * Malformed market rows must never silently feed yields, charts or AI.
 * Validation is QUERY-SCOPED GOVERNANCE ONLY — records are excluded from
 * aggregations and reported, never deleted or mutated (§38 quarantine).
 *
 * Two severity tiers:
 *  - HARD-invalid rows are excluded from every chart, statistic and listing
 *    (zero-bedroom non-studio rents; non-positive rent/amount).
 *  - SOFT-invalid rows (missing/zero area) remain valid for absolute-value
 *    statistics but are excluded from per-sqft DERIVED metrics, because a
 *    missing size cannot invalidate an observed contract rent — it only makes
 *    rent/sqft incomputable ("do not compute misleading derived metrics").
 * ==========================================================================*/

/** Validation summary attached to market API responses (§19.5 transparency). */
export interface MarketValidationSummary {
  /** Rows matched by the current filters, BEFORE validation. */
  totalRecords: number;
  /** Rows passing hard validity — these feed charts & statistics. */
  validRecords: number;
  /** Rows failing hard validity — excluded from charts & statistics. */
  excludedRecords: number;
  /** Reason key → affected row count (soft reasons included; a row may carry
   *  several reasons, so values may overlap and need not sum to total). */
  exclusionReasons: Record<string, number>;
  /** Hard-valid rows with a usable area — eligible for per-sqft derived metrics. */
  perSqftEligibleRecords: number;
}

export interface RentValidationFields {
  bedrooms: number | null;
  propertyType: string;
  annualRentMinor: bigint;
  sizeSqft: number | null;
}

export interface TransactionValidationFields {
  amountMinor: bigint;
  sizeSqft: number | null;
}

export interface ValidatedRows<T> {
  validRows: T[];
  validation: MarketValidationSummary;
}

/** Canonical exclusion-reason keys (documented in docs/V2_DATA_PROVENANCE.md). */
export const RENT_EXCLUSION_REASONS = [
  "zero_bedrooms_non_studio",
  "non_positive_rent",
  "missing_size",
  "non_positive_size",
] as const;

export const TRANSACTION_EXCLUSION_REASONS = [
  "non_positive_amount",
  "missing_size",
  "non_positive_size",
] as const;

function emptyReasons(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;
  return out;
}

function isStudio(propertyType: string): boolean {
  return /studio/i.test(propertyType);
}

function hasUsableSize(sizeSqft: number | null): boolean {
  return sizeSqft !== null && sizeSqft !== undefined && sizeSqft > 0;
}

/**
 * Validate rental-contract rows (§19.5):
 *  - bedrooms = 0 with a non-studio property type → HARD invalid;
 *  - annualRentMinor <= 0 → HARD invalid;
 *  - sizeSqft missing/null/<=0 → SOFT invalid (excluded from rent/sqft only).
 */
export function validateRentRecords<T extends RentValidationFields>(rows: readonly T[]): ValidatedRows<T> {
  const reasons = emptyReasons(RENT_EXCLUSION_REASONS);
  const validRows: T[] = [];
  let perSqftEligible = 0;

  for (const r of rows) {
    let hardInvalid = false;

    if ((r.bedrooms ?? null) === 0 && !isStudio(r.propertyType)) {
      reasons.zero_bedrooms_non_studio += 1;
      hardInvalid = true;
    }
    if (r.annualRentMinor <= 0n) {
      reasons.non_positive_rent += 1;
      hardInvalid = true;
    }
    if (r.sizeSqft === null || r.sizeSqft === undefined) {
      reasons.missing_size += 1;
    } else if (r.sizeSqft <= 0) {
      reasons.non_positive_size += 1;
    }

    if (hardInvalid) continue;
    validRows.push(r);
    if (hasUsableSize(r.sizeSqft)) perSqftEligible += 1;
  }

  return {
    validRows,
    validation: {
      totalRecords: rows.length,
      validRecords: validRows.length,
      excludedRecords: rows.length - validRows.length,
      exclusionReasons: reasons,
      perSqftEligibleRecords: perSqftEligible,
    },
  };
}

/**
 * Validate sale-transaction rows (§38):
 *  - amountMinor <= 0 → HARD invalid;
 *  - sizeSqft missing/null/<=0 → SOFT invalid (excluded from AED/sqft only).
 */
export function validateTransactionRecords<T extends TransactionValidationFields>(rows: readonly T[]): ValidatedRows<T> {
  const reasons = emptyReasons(TRANSACTION_EXCLUSION_REASONS);
  const validRows: T[] = [];
  let perSqftEligible = 0;

  for (const r of rows) {
    let hardInvalid = false;

    if (r.amountMinor <= 0n) {
      reasons.non_positive_amount += 1;
      hardInvalid = true;
    }
    if (r.sizeSqft === null || r.sizeSqft === undefined) {
      reasons.missing_size += 1;
    } else if (r.sizeSqft <= 0) {
      reasons.non_positive_size += 1;
    }

    if (hardInvalid) continue;
    validRows.push(r);
    if (hasUsableSize(r.sizeSqft)) perSqftEligible += 1;
  }

  return {
    validRows,
    validation: {
      totalRecords: rows.length,
      validRecords: validRows.length,
      excludedRecords: rows.length - validRows.length,
      exclusionReasons: reasons,
      perSqftEligibleRecords: perSqftEligible,
    },
  };
}

/* ============================================================================
 * V2 entity detail read models (U07 §15 + U08 §16/§17/§18) — additive.
 *
 * Each V2 projection keeps the V1 base shape byte-compatible and only adds
 * fields the upgraded detail pages need (unit inventory with tower/view data,
 * linked-listing slugs, advisor summaries, inventory splits, payment-plan
 * pattern aggregation, agent photo resolution). V1 functions stay untouched.
 * ==========================================================================*/

/** Resolve a batch of agent photos from photoMediaId → MediaDTO (null-safe). */
async function resolveAgentPhotos(agentIds: string[]): Promise<Map<string, MediaDTO>> {
  const rows = agentIds.length
    ? await db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, photoMediaId: true } })
    : [];
  const mediaIds = rows.map((r) => r.photoMediaId).filter((m): m is string => !!m);
  const media = mediaIds.length ? await db.mediaAsset.findMany({ where: { id: { in: mediaIds }, isPrivate: false, kind: "IMAGE" } }) : [];
  const mediaMap = new Map(media.map((m) => [m.id, mediaDto(m)]));
  const out = new Map<string, MediaDTO>();
  for (const r of rows) {
    if (r.photoMediaId) {
      const m = mediaMap.get(r.photoMediaId);
      if (m) out.set(r.id, m);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- U07 §15 --- */

export interface ProjectDetailV2Unit {
  id: string;
  unitNumber: string | null;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: string | null;
  currency: string;
  availabilityStatus: string;
  floor: number | null;
  aspect: string | null;
  /** Slug of the published property/listing this unit maps to (null = no live listing). */
  propertySlug: string | null;
}

export interface ProjectDetailV2 {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  summary: string | null;
  description: string | null;
  status: string;
  projectType: string;
  launchDate: string | null;
  handoverDate: string | null;
  completionPercent: number | null;
  constructionStatus: string | null;
  constructionSourceUrl: string | null;
  constructionSourceVerifiedAt: string | null;
  totalUnits: number | null;
  startingPriceMinor: string | null;
  currency: string;
  lat: number;
  lng: number;
  highlights: string[];
  keyAmenities: string[];
  developer: { id: string; name: string; slug: string; summary: string | null; verificationStatus: string; lastVerifiedAt: string | null };
  community: { id: string; name: string; slug: string; summary: string | null; lat: number; lng: number };
  media: MediaDTO[];
  progressMedia?: MediaDTO[];
  brochure: MediaDTO | null;
  amenities: { key: string; name: string }[];
  paymentPlans: {
    id: string;
    name: string;
    totalPercent: number;
    postHandover: boolean;
    verificationStatus: string;
    isDefault: boolean;
    installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[];
  }[];
  documents: { id: string; label: string | null; docType: string; gated: boolean; url: string }[];
  units: ProjectDetailV2Unit[];
  statusHistory: { toStatus: string; reason: string | null; createdAt: string }[];
  availableProperties: {
    slug: string;
    title: string;
    bedrooms: number;
    bathrooms: number;
    areaSqft: number | null;
    priceMinor: string;
    availabilityStatus: string;
    cover: MediaDTO | null;
  }[];
  /** Advisors carrying live listings inside this project (deduped). */
  advisors: {
    id: string;
    slug: string;
    name: string;
    jobTitle: string;
    phoneE164: string | null;
    whatsappE164: string | null;
    leadCapacityState: string;
    photo: MediaDTO | null;
    /* V3-02 verified-team fields (additive) */
    photoUrl: string | null;
    phoneDisplay: string | null;
    department: string | null;
    publicAdvisor: boolean;
  }[];
  isDemoData: boolean;
  sourceVerifiedAt: string | null;
}

export async function getProjectDetailV2(slug: string): Promise<ProjectDetailV2 | null> {
  const project = await db.project.findFirst({
    where: { slug, ...PUBLIC_PROJECT_WHERE },
    include: {
      developer: true,
      community: true,
      media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } } },
      amenities: { include: { amenity: true } },
      paymentPlans: { where: { verificationStatus: { in: ["PUBLISHED", "VERIFIED"] } }, include: { installments: true }, orderBy: { isDefault: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 6 },
      documents: { include: { media: { include: { poster: { select: { url: true } } } } } },
    },
  });
  if (!project) return null;

  const [units, availableProperties, brochure] = await Promise.all([
    db.propertyUnit.findMany({
      where: { projectId: project.id },
      orderBy: [{ bedrooms: "asc" }, { areaSqft: "asc" }],
      include: { property: { select: { slug: true, publicationStatus: true, deletedAt: true } } },
    }),
    db.property.findMany({
      where: { projectId: project.id, ...PUBLIC_PROPERTY_WHERE },
      include: {
        community: true,
        listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" }, include: { agent: true } },
        media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
      },
      take: 12,
    }),
    project.brochureMediaId
      ? db.mediaAsset.findFirst({ where: { id: project.brochureMediaId, isPrivate: false, kind: { in: ["IMAGE", "DOCUMENT"] } } })
      : Promise.resolve(null),
  ]);

  /* Advisors = agents carrying the live listings inside this project (deduped, ordered). */
  const advisorMap = new Map<string, ProjectDetailV2["advisors"][number]>();
  for (const p of availableProperties) {
    for (const l of p.listings) {
      if (l.agent?.active && l.agent.publicAdvisor && !advisorMap.has(l.agent.id)) {
        advisorMap.set(l.agent.id, {
          id: l.agent.id,
          slug: l.agent.slug,
          name: l.agent.name,
          jobTitle: l.agent.jobTitle,
          phoneE164: l.agent.phoneE164,
          whatsappE164: l.agent.whatsappE164,
          leadCapacityState: l.agent.leadCapacityState,
          photo: null,
          photoUrl: l.agent.photoUrl,
          phoneDisplay: l.agent.phoneDisplay,
          department: l.agent.department,
          publicAdvisor: l.agent.publicAdvisor,
        });
      }
    }
  }
  const advisors = Array.from(advisorMap.values());
  const photoMap = await resolveAgentPhotos(advisors.map((a) => a.id));
  for (const a of advisors) {
    const photo = photoMap.get(a.id);
    if (photo) a.photo = photo;
  }

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    tagline: project.tagline,
    summary: project.summary,
    description: project.description,
    status: project.status,
    projectType: project.projectType,
    launchDate: project.launchDate?.toISOString() ?? null,
    handoverDate: project.handoverDate?.toISOString() ?? null,
    completionPercent: project.completionPercent,
    constructionStatus: project.constructionStatus,
    constructionSourceUrl: project.constructionSourceUrl,
    constructionSourceVerifiedAt: project.constructionSourceVerifiedAt?.toISOString() ?? null,
    totalUnits: project.totalUnits,
    startingPriceMinor: project.startingPriceMinor?.toString() ?? null,
    currency: project.currency,
    lat: project.lat,
    lng: project.lng,
    highlights: parseJson<string[]>(project.highlightsJson, []),
    keyAmenities: parseJson<string[]>(project.keyAmenitiesJson, []),
    developer: {
      id: project.developer.id,
      name: project.developer.name,
      slug: project.developer.slug,
      summary: project.developer.summary,
      verificationStatus: project.developer.verificationStatus,
      lastVerifiedAt: project.developer.lastVerifiedAt?.toISOString() ?? null,
    },
    community: {
      id: project.community.id,
      name: project.community.name,
      slug: project.community.slug,
      summary: project.community.summary,
      lat: project.community.lat,
      lng: project.community.lng,
    },
    media: project.media.filter((m) => m.section === "GALLERY").map((m) => mediaDto({ ...m.media, altText: m.altText ?? m.media.altText, caption: m.caption ?? m.media.caption })),
    progressMedia: project.media.filter((m) => m.section === "PROGRESS").map((m) => mediaDto({ ...m.media, altText: m.altText ?? m.media.altText, caption: m.caption ?? m.media.caption })),
    brochure: brochure ? mediaDto(brochure) : null,
    amenities: project.amenities.map((a) => ({ key: a.amenity.key, name: a.amenity.name })),
    paymentPlans: project.paymentPlans.map((p) => ({
      id: p.id,
      name: p.name,
      totalPercent: p.totalPercent,
      postHandover: p.postHandover,
      verificationStatus: p.verificationStatus,
      isDefault: p.isDefault,
      installments: p.installments
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((i) => ({ sequence: i.sequence, label: i.label, percent: i.percent, dueOffsetMonths: i.dueOffsetMonths })),
    })),
    documents: project.documents.map((d) => ({ id: d.id, label: d.label, docType: d.docType, gated: d.gated, url: d.gated ? "" : d.media.url })),
    units: units.map((u) => ({
      id: u.id,
      unitNumber: u.unitNumber,
      unitType: u.unitType,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      areaSqft: u.areaSqft,
      priceMinor: u.priceMinor?.toString() ?? null,
      currency: u.currency,
      availabilityStatus: u.availabilityStatus,
      floor: u.floor,
      aspect: u.aspect,
      propertySlug:
        u.property && u.property.publicationStatus === "PUBLISHED" && u.property.deletedAt === null ? u.property.slug : null,
    })),
    statusHistory: project.statusHistory.map((h) => ({ toStatus: h.toStatus, reason: h.reason, createdAt: h.createdAt.toISOString() })),
    availableProperties: availableProperties
      .filter((p) => p.listings[0])
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        areaSqft: p.builtUpAreaSqft,
        priceMinor: p.listings[0].priceMinor.toString(),
        availabilityStatus: p.listings[0].availabilityStatus,
        cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      })),
    advisors,
    isDemoData: project.isDemoData,
    sourceVerifiedAt: project.sourceVerifiedAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------------------- U08 §16 ------ */

export interface CommunityDetailV2Listing {
  slug: string;
  title: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  priceMinor: string;
  currency: string;
  listingType: string;
  availabilityStatus: string;
  cover: MediaDTO | null;
  lat: number;
  lng: number;
}

export interface CommunityDetailV2Project {
  slug: string;
  name: string;
  status: string;
  developerName: string;
  developerSlug: string;
  startingPriceMinor: string | null;
  currency: string;
  handoverDate: string | null;
  completionPercent: number | null;
  totalUnits: number | null;
  cover: MediaDTO | null;
  lat: number;
  lng: number;
}

export interface CommunityDetailV2 {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  areaType: string;
  lat: number;
  lng: number;
  radiusMeters: number | null;
  avgPricePerSqftMinor: string | null;
  currency: string;
  lifestyleTags: string[];
  transport: { type: string; name: string; distance: string }[];
  schools: { name: string; rating: string }[];
  healthcare: { name: string; type: string }[];
  retail: { name: string; type: string }[];
  boundary: unknown;
  image: MediaDTO | null;
  properties: CommunityDetailV2Listing[];
  saleProperties: CommunityDetailV2Listing[];
  rentProperties: CommunityDetailV2Listing[];
  projects: CommunityDetailV2Project[];
  metrics: {
    metricKey: string;
    periodStart: string;
    valueNumeric: number;
    unit: string;
    sourceName: string;
    methodology: string | null;
    isIllustrative: boolean;
  }[];
  propertyTypeCounts: { propertyType: string; count: number }[];
  supplyPipeline: { totalProjects: number; underConstruction: number; offPlan: number; ready: number };
  agents: {
    slug: string;
    name: string;
    jobTitle: string;
    photo: MediaDTO | null;
    photoUrl: string | null;
    leadCapacityState: string;
    phoneE164: string | null;
    whatsappE164: string | null;
  }[];
  isDemoData: boolean;
}

function communityListingDto(p: {
  slug: string;
  title: string;
  bedrooms: number;
  bathrooms: number;
  builtUpAreaSqft: number | null;
  lat: number;
  lng: number;
  listings: { priceMinor: bigint; currency: string; listingType: string; availabilityStatus: string }[];
  media: { media: Parameters<typeof mediaDto>[0] }[];
}): CommunityDetailV2Listing | null {
  const l = p.listings[0];
  if (!l) return null;
  return {
    slug: p.slug,
    title: p.title,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    areaSqft: p.builtUpAreaSqft,
    priceMinor: l.priceMinor.toString(),
    currency: l.currency,
    listingType: l.listingType,
    availabilityStatus: l.availabilityStatus,
    cover: p.media[0] ? mediaDto(p.media[0].media) : null,
    lat: p.lat,
    lng: p.lng,
  };
}

export async function getCommunityDetailV2(slug: string): Promise<CommunityDetailV2 | null> {
  const community = await db.community.findFirst({ where: { slug, ...PUBLIC_COMMUNITY_WHERE } });
  if (!community) return null;

  const [properties, projects, metrics, boundary, agents, typeCounts] = await Promise.all([
    db.property.findMany({
      where: { communityId: community.id, ...PUBLIC_PROPERTY_WHERE },
      include: {
        listings: { where: publicListingWindowWhere(), orderBy: { createdAt: "desc" } },
        media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
        project: { include: { developer: true } },
      },
      take: 30,
    }),
    db.project.findMany({
      where: { communityId: community.id, ...PUBLIC_PROJECT_WHERE },
      include: { developer: true, media: { where: { section: "GALLERY", media: { mimeType: { startsWith: "image/" } } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.marketMetric.findMany({
      where: { communityId: community.id },
      orderBy: { periodStart: "desc" },
      take: 60,
    }),
    db.locationBoundary.findUnique({ where: { communityId: community.id } }),
    db.agentCommunity.findMany({ where: { communityId: community.id, agent: { is: PUBLIC_AGENT_WHERE } }, include: { agent: true }, take: 8 }),
    db.property.groupBy({
      by: ["propertyType"],
      where: { communityId: community.id, ...PUBLIC_PROPERTY_WHERE },
      _count: true,
    }),
  ]);

  const coverMedia = community.imageMediaId ? await db.mediaAsset.findUnique({ where: { id: community.imageMediaId } }) : null;
  const photoMap = await resolveAgentPhotos(agents.map((a) => a.agent.id));

  const sale = properties
    .filter((p) => p.listings[0]?.listingType === "SALE")
    .map(communityListingDto)
    .filter((x): x is CommunityDetailV2Listing => x !== null)
    .slice(0, 9);
  const rent = properties
    .filter((p) => p.listings[0]?.listingType === "RENT")
    .map(communityListingDto)
    .filter((x): x is CommunityDetailV2Listing => x !== null)
    .slice(0, 9);
  const mixed = properties
    .map(communityListingDto)
    .filter((x): x is CommunityDetailV2Listing => x !== null)
    .slice(0, 9);

  const supplyPipeline = projects.reduce(
    (acc, p) => {
      acc.totalProjects += 1;
      if (p.status === "UNDER_CONSTRUCTION") acc.underConstruction += 1;
      else if (p.status === "OFF_PLAN") acc.offPlan += 1;
      else acc.ready += 1;
      return acc;
    },
    { totalProjects: 0, underConstruction: 0, offPlan: 0, ready: 0 }
  );

  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    summary: community.summary,
    description: community.description,
    areaType: community.areaType,
    lat: community.lat,
    lng: community.lng,
    radiusMeters: community.radiusMeters,
    avgPricePerSqftMinor: community.avgPricePerSqftMinor?.toString() ?? null,
    currency: community.currency,
    lifestyleTags: parseJson<string[]>(community.lifestyleTagsJson, []),
    transport: parseJson<{ type: string; name: string; distance: string }[]>(community.transportJson, []),
    schools: parseJson<{ name: string; rating: string }[]>(community.schoolsJson, []),
    healthcare: parseJson<{ name: string; type: string }[]>(community.healthcareJson, []),
    retail: parseJson<{ name: string; type: string }[]>(community.retailJson, []),
    boundary: boundary ? parseJson<unknown>(boundary.geoJson, null) : null,
    image: coverMedia ? mediaDto(coverMedia) : null,
    properties: mixed,
    saleProperties: sale,
    rentProperties: rent,
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      developerName: p.developer.name,
      developerSlug: p.developer.slug,
      startingPriceMinor: p.startingPriceMinor?.toString() ?? null,
      currency: p.currency,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      completionPercent: p.completionPercent,
      totalUnits: p.totalUnits,
      cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      lat: p.lat,
      lng: p.lng,
    })),
    metrics: metrics.map((m) => ({
      metricKey: m.metricKey,
      periodStart: m.periodStart.toISOString(),
      valueNumeric: m.valueNumeric,
      unit: m.unit,
      sourceName: m.sourceName,
      methodology: m.methodology,
      isIllustrative: m.isIllustrative,
    })),
    propertyTypeCounts: typeCounts
      .map((c) => ({ propertyType: c.propertyType, count: c._count }))
      .sort((a, b) => b.count - a.count),
    supplyPipeline,
    agents: agents.map(({ agent }) => ({
      slug: agent.slug,
      name: agent.name,
      jobTitle: agent.jobTitle,
      photo: photoMap.get(agent.id) ?? null,
      photoUrl: agent.photoUrl,
      leadCapacityState: agent.leadCapacityState,
      phoneE164: agent.phoneE164,
      whatsappE164: agent.whatsappE164,
    })),
    isDemoData: community.isDemoData,
  };
}

/* ------------------------------------------------------------- U08 §17 ------ */

export interface DeveloperDetailV2 {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  websiteUrl: string | null;
  headquarters: string | null;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  foundedYear: number | null;
  logo: MediaDTO | null;
  projects: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    status: string;
    community: { id: string; name: string; slug: string };
    developer: { id: string; name: string; slug: string };
    startingPrice: { minor: string; currency: string } | null;
    handoverDate: string | null;
    completionPercent: number | null;
    cover: MediaDTO | null;
    totalUnits: number | null;
    unitCount: number;
    lat: number;
    lng: number;
  }[];
  paymentPlanPatterns: {
    projectId: string;
    projectSlug: string;
    projectName: string;
    planId: string;
    planName: string;
    verificationStatus: string;
    isDefault: boolean;
    installments: { sequence: number; label: string; percent: number; dueOffsetMonths: number | null }[];
  }[];
  deliverySummary: { total: number; completed: number; underConstruction: number; offPlan: number; ready: number };
  isDemoData: boolean;
}

export async function getDeveloperDetailV2(slug: string): Promise<DeveloperDetailV2 | null> {
  const developer = await db.developer.findFirst({ where: { slug, ...PUBLIC_DEVELOPER_WHERE } });
  if (!developer) return null;
  const logo = developer.logoMediaId
    ? await db.mediaAsset.findFirst({ where: { id: developer.logoMediaId, isPrivate: false, kind: "IMAGE" } })
    : null;
  const projects = await db.project.findMany({
    where: { developerId: developer.id, ...PUBLIC_PROJECT_WHERE },
    include: {
      community: true,
      media: { where: { section: "GALLERY", media: { mimeType: { startsWith: "image/" } } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { media: { include: { poster: { select: { url: true } } } } }, take: 1 },
      paymentPlans: { where: { verificationStatus: { in: ["PUBLISHED", "VERIFIED"] } }, include: { installments: true }, orderBy: { isDefault: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const unitCounts = await db.propertyUnit.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: true,
  });
  const unitCountMap = new Map(unitCounts.map((u) => [u.projectId, u._count]));

  const deliverySummary = projects.reduce(
    (acc, p) => {
      acc.total += 1;
      if (p.status === "COMPLETED") acc.completed += 1;
      else if (p.status === "UNDER_CONSTRUCTION") acc.underConstruction += 1;
      else if (p.status === "OFF_PLAN") acc.offPlan += 1;
      else acc.ready += 1;
      return acc;
    },
    { total: 0, completed: 0, underConstruction: 0, offPlan: 0, ready: 0 }
  );

  return {
    id: developer.id,
    slug: developer.slug,
    name: developer.name,
    summary: developer.summary,
    description: developer.description,
    websiteUrl: developer.websiteUrl,
    headquarters: developer.headquarters,
    verificationStatus: developer.verificationStatus,
    lastVerifiedAt: developer.lastVerifiedAt?.toISOString() ?? null,
    foundedYear: developer.foundedYear,
    logo: logo ? mediaDto(logo) : null,
    projects: projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      status: p.status,
      community: { id: p.community.id, name: p.community.name, slug: p.community.slug },
      developer: { id: developer.id, name: developer.name, slug: developer.slug },
      startingPrice: p.startingPriceMinor ? { minor: p.startingPriceMinor.toString(), currency: p.currency } : null,
      handoverDate: p.handoverDate?.toISOString() ?? null,
      completionPercent: p.completionPercent,
      cover: p.media[0] ? mediaDto(p.media[0].media) : null,
      totalUnits: p.totalUnits,
      unitCount: unitCountMap.get(p.id) ?? 0,
      lat: p.lat,
      lng: p.lng,
    })),
    paymentPlanPatterns: projects.flatMap((p) =>
      p.paymentPlans.map((plan) => ({
        projectId: p.id,
        projectSlug: p.slug,
        projectName: p.name,
        planId: plan.id,
        planName: plan.name,
        verificationStatus: plan.verificationStatus,
        isDefault: plan.isDefault,
        installments: plan.installments
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((i) => ({ sequence: i.sequence, label: i.label, percent: i.percent, dueOffsetMonths: i.dueOffsetMonths })),
      }))
    ),
    deliverySummary,
    isDemoData: developer.isDemoData,
  };
}

/* ------------------------------------------------------------- U08 §18 ------ */

export async function getAgentDetailV2(
  slug: string
): Promise<(AgentDTO & { listings: ListingCardDTO[] }) | null> {
  const base = await getAgentDetail(slug);
  if (!base) return null;
  const photoMap = await resolveAgentPhotos([base.id]);
  const photo = photoMap.get(base.id) ?? null;
  return { ...base, photo };
}

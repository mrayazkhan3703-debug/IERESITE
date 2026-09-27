import type { Prisma } from "@prisma/client";

/** Canonical predicates for data that may cross an unauthenticated boundary. */
export const PUBLIC_PROPERTY_WHERE = {
  publicationStatus: "PUBLISHED",
  deletedAt: null,
} satisfies Prisma.PropertyWhereInput;

export const PUBLIC_PROJECT_WHERE = {
  publicationStatus: "PUBLISHED",
  deletedAt: null,
} satisfies Prisma.ProjectWhereInput;

export const PUBLIC_COMMUNITY_WHERE = {
  publicationStatus: "PUBLISHED",
} satisfies Prisma.CommunityWhereInput;

export const PUBLIC_DEVELOPER_WHERE = {
  projects: { some: PUBLIC_PROJECT_WHERE },
} satisfies Prisma.DeveloperWhereInput;

export const PUBLIC_AGENT_WHERE = {
  active: true,
  publicAdvisor: true,
} satisfies Prisma.AgentWhereInput;

export const PUBLIC_TESTIMONIAL_WHERE = {
  status: "PUBLISHED",
  verified: true,
  consentCapturedAt: { not: null },
} satisfies Prisma.TestimonialWhereInput;

/** Listing publication is time-dependent, so callers inject time in tests. */
export function publicListingWindowWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    availabilityStatus: { not: "WITHDRAWN" },
    publishedAt: { not: null, lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export function publicListingWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    ...publicListingWindowWhere(now),
    property: { is: PUBLIC_PROPERTY_WHERE },
  };
}

export function publicContentWhere(now = new Date()): Prisma.ContentEntryWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { not: null, lte: now },
  };
}

export function publicMarketReportWhere(now = new Date()): Prisma.MarketReportWhereInput {
  return {
    status: "PUBLISHED",
    publishedAt: { not: null, lte: now },
  };
}

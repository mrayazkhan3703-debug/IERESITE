import type { Prisma } from "@prisma/client";

/** Canonical predicates for data that may cross an unauthenticated boundary. */
export const PUBLIC_COMMUNITY_WHERE = {
  publicationStatus: "PUBLISHED",
} satisfies Prisma.CommunityWhereInput;

export const PUBLIC_PROJECT_WHERE = {
  publicationStatus: "PUBLISHED",
  deletedAt: null,
  community: { is: PUBLIC_COMMUNITY_WHERE },
} satisfies Prisma.ProjectWhereInput;

export const PUBLIC_PROPERTY_WHERE = {
  publicationStatus: "PUBLISHED",
  deletedAt: null,
  community: { is: PUBLIC_COMMUNITY_WHERE },
  AND: [{ OR: [{ projectId: null }, { project: { is: PUBLIC_PROJECT_WHERE } }] }],
} satisfies Prisma.PropertyWhereInput;

export const PUBLIC_DEVELOPER_WHERE = {
  projects: { some: PUBLIC_PROJECT_WHERE },
} satisfies Prisma.DeveloperWhereInput;

export const PUBLIC_AGENT_WHERE = {
  active: true,
  publicAdvisor: true,
  // Older explicitly public standalone profiles have no linked login account.
  // A linked account must still meet the publication prerequisites today.
  AND: [{ OR: [{ userId: null }, { user: { is: { isActive: true, emailVerified: { not: null }, roles: { some: { role: { key: "AGENT" } } } } } }] }],
} satisfies Prisma.AgentWhereInput;

/** Website staff publication does not require a login or email verification. */
export const PUBLIC_TEAM_WHERE = { active: true, publicTeam: true } satisfies Prisma.AgentWhereInput;
export const PUBLIC_PROFILE_WHERE = { OR: [PUBLIC_AGENT_WHERE, PUBLIC_TEAM_WHERE] } satisfies Prisma.AgentWhereInput;

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

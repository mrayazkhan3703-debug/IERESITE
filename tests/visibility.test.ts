import { describe, expect, test } from "bun:test";
import {
  PUBLIC_AGENT_WHERE,
  PUBLIC_COMMUNITY_WHERE,
  PUBLIC_DEVELOPER_WHERE,
  PUBLIC_PROJECT_WHERE,
  PUBLIC_PROPERTY_WHERE,
  PUBLIC_TESTIMONIAL_WHERE,
  publicContentWhere,
  publicListingWhere,
  publicListingWindowWhere,
  publicMarketReportWhere,
} from "@/server/domain/visibility";

describe("public visibility policy", () => {
  const now = new Date("2026-09-22T08:00:00.000Z");

  test("canonical entities exclude drafts and soft-deleted records", () => {
    expect(PUBLIC_PROPERTY_WHERE).toEqual({ publicationStatus: "PUBLISHED", deletedAt: null });
    expect(PUBLIC_PROJECT_WHERE).toEqual({ publicationStatus: "PUBLISHED", deletedAt: null });
    expect(PUBLIC_COMMUNITY_WHERE).toEqual({ publicationStatus: "PUBLISHED" });
    expect(PUBLIC_DEVELOPER_WHERE).toEqual({ projects: { some: PUBLIC_PROJECT_WHERE } });
    expect(PUBLIC_AGENT_WHERE).toEqual({ active: true, publicAdvisor: true });
    expect(PUBLIC_TESTIMONIAL_WHERE).toEqual({ status: "PUBLISHED", verified: true, consentCapturedAt: { not: null } });
  });

  test("listing windows reject unpublished, expired, and withdrawn inventory", () => {
    expect(publicListingWindowWhere(now)).toEqual({
      availabilityStatus: { not: "WITHDRAWN" },
      publishedAt: { not: null, lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
    expect(publicListingWhere(now)).toEqual({
      ...publicListingWindowWhere(now),
      property: { is: PUBLIC_PROPERTY_WHERE },
    });
  });

  test("scheduled content and reports cannot leak before publication", () => {
    const expected = { status: "PUBLISHED", publishedAt: { not: null, lte: now } };
    expect(publicContentWhere(now)).toEqual(expected);
    expect(publicMarketReportWhere(now)).toEqual(expected);
  });
});

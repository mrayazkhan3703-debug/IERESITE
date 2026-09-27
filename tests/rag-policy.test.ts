import { describe, expect, it } from "bun:test";
import { isRagSourceRetrievable, normalizeRagLocale } from "@/server/rag/policy";
import { hashRagContent } from "@/server/rag/provenance";

const now = new Date("2026-09-24T12:00:00.000Z");
const reviewedSource = {
  isActive: true,
  isApproved: true,
  trustTier: "OFFICIAL",
  verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
  freshnessReviewDueAt: new Date("2026-12-01T00:00:00.000Z"),
};

describe("RAG source access policy", () => {
  it("requires active, approved, verified, trust-tiered sources within review freshness", () => {
    expect(isRagSourceRetrievable(reviewedSource, now)).toBe(true);
    expect(isRagSourceRetrievable({ ...reviewedSource, isActive: false }, now)).toBe(false);
    expect(isRagSourceRetrievable({ ...reviewedSource, isApproved: false }, now)).toBe(false);
    expect(isRagSourceRetrievable({ ...reviewedSource, trustTier: "UNVERIFIED" }, now)).toBe(false);
    expect(isRagSourceRetrievable({ ...reviewedSource, verifiedAt: null }, now)).toBe(false);
    expect(isRagSourceRetrievable({ ...reviewedSource, verifiedAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe(false);
    expect(isRagSourceRetrievable({ ...reviewedSource, freshnessReviewDueAt: now }, now)).toBe(false);
  });

  it("normalizes locale to the supported English and Arabic partitions", () => {
    expect(normalizeRagLocale("ar")).toBe("ar");
    expect(normalizeRagLocale("ar-AE")).toBe("ar");
    expect(normalizeRagLocale("en")).toBe("en");
    expect(normalizeRagLocale("fr")).toBe("en");
    expect(normalizeRagLocale(undefined)).toBe("en");
  });

  it("uses a full SHA-256 digest instead of retaining a reversible content prefix", () => {
    const digest = hashRagContent("approved document content");
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("approved document content");
  });
});

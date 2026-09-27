export type RagSourceApproval = {
  isActive: boolean;
  isApproved: boolean;
  trustTier: string;
  verifiedAt: Date | null;
  freshnessReviewDueAt: Date | null;
};

export function normalizeRagLocale(locale: string | undefined): "en" | "ar" {
  return locale?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function isRagSourceRetrievable(source: RagSourceApproval, now = new Date()): boolean {
  return source.isActive
    && source.isApproved
    && source.trustTier !== "UNVERIFIED"
    && source.verifiedAt instanceof Date
    && !Number.isNaN(source.verifiedAt.getTime())
    && source.freshnessReviewDueAt instanceof Date
    && !Number.isNaN(source.freshnessReviewDueAt.getTime())
    && source.verifiedAt <= now
    && source.freshnessReviewDueAt > now;
}

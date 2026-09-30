export type PublicContentLocaleMember = {
  locale: string;
  slug: string;
  status: string;
  publishedAt: Date | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceVerifiedAt?: Date | null;
  freshnessReviewDueAt?: Date | null;
};

export type ContentLocaleAlternates = { en: string; ar: string; "x-default": string };

/** Hreflang is emitted only when both paired translations are publicly live. */
export function publicContentLocaleAlternates(
  section: string,
  members: PublicContentLocaleMember[],
  now = new Date(),
): ContentLocaleAlternates | null {
  if (!/^[a-z-]+$/.test(section)) return null;
  const publicMembers = members.filter((member) => member.status === "PUBLISHED" && member.publishedAt !== null && member.publishedAt <= now && (section !== "international" || Boolean(member.sourceName?.trim() && member.sourceUrl?.startsWith("https://") && member.sourceVerifiedAt && member.sourceVerifiedAt <= now && member.freshnessReviewDueAt && member.freshnessReviewDueAt > now)));
  const english = publicMembers.find((member) => member.locale === "en");
  const arabic = publicMembers.find((member) => member.locale === "ar");
  if (!english || !arabic) return null;
  if (![english.slug, arabic.slug].every((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) return null;
  const en = `/${section}/${english.slug}`;
  return { en, ar: `/ar/${section}/${arabic.slug}`, "x-default": en };
}

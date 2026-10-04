import { normalizeSearchText } from "@/server/search/normalize";

const nameKey = (value: string) => normalizeSearchText(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Resolve a published name/slug without dropping unknown or ambiguous criteria. */
export function resolveAdvisorCommunities(values: string[], rows: { name: string; slug: string }[]): string[] {
  const slugs = new Set(rows.map(row => row.slug));
  const named = rows.map(row => ({ ...row, key: nameKey(row.name) })).filter(row => row.key.length > 0);
  return values.map(value => {
    if (slugs.has(value)) return value;
    const key = nameKey(value);
    if (!key) return value;
    const exact = named.filter(row => row.key === key);
    if (exact.length === 1) return exact[0].slug;
    if (exact.length > 1) return value;
    const partial = key.length >= 3
      ? named.filter(row => row.key.length >= 3 && (row.key.includes(key) || key.includes(row.key)))
      : [];
    return partial.length === 1 ? partial[0].slug : value;
  });
}

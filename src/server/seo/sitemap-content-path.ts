/** Return the public canonical route for a published content entry. */
export function contentSitemapPath(contentType: string, slug: string): string | null {
  if (contentType === "GUIDE" || contentType === "AREA_GUIDE") return `/guides/${slug}`;
  if (contentType === "ARTICLE") return `/insights/${slug}`;
  return null;
}

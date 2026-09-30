/** Return the public canonical route for a published content entry. */
export function contentSitemapPath(contentType: string, slug: string): string | null {
  if (contentType === "GUIDE" || contentType === "AREA_GUIDE") return `/guides/${slug}`;
  if (contentType === "ARTICLE") return `/insights/${slug}`;
  if (contentType === "PAGE") return `/pages/${slug}`;
  if (contentType === "INTERNATIONAL_GUIDE") return `/international/${slug}`;
  return null;
}

"use client";

import * as React from "react";

const COMMUNITY_IMAGES: Record<string, string> = {
  "arabian-ranches": "arabian-ranches.jpg",
  "business-bay": "business-bay.jpg",
  "downtown-dubai": "downtown-dubai.jpg",
  "dubai-hills-estate": "dubai-hills-estate.jpg",
  "dubai-marina": "dubai-marina.jpg",
  "emirates-hills": "emirates-hills.jpg",
  jvc: "jvc.jpg",
  "jumeirah-village-circle": "jumeirah-village-circle.jpg",
  "palm-jumeirah": "palm-jumeirah.jpg",
};
const PLACEHOLDER = "/images/communities/community-placeholder.svg";

/** Resolves only known local image names; API content never becomes a file path. */
export function communityImageFallback(slug: string) {
  const filename = COMMUNITY_IMAGES[slug.trim().toLowerCase()];
  return filename ? `/images/communities/${filename}` : PLACEHOLDER;
}

export function CommunityImage({
  slug,
  imageUrl,
  alt,
  className,
  loading = "lazy",
}: {
  slug: string;
  imageUrl?: string | null;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const fallback = communityImageFallback(slug);
  const [src, setSrc] = React.useState(imageUrl || fallback);
  React.useEffect(() => setSrc(imageUrl || fallback), [imageUrl, fallback]);
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      onError={() => setSrc((current) => current === PLACEHOLDER ? current : current === fallback ? PLACEHOLDER : fallback)}
    />
  );
}

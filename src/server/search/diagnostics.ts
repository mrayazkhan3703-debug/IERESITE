import { validMapPoint } from "@/lib/map-state";
export function listingExclusionReasons(row: { publishedAt: Date | null; expiresAt: Date | null; availabilityStatus: string; property: { publicationStatus: string; deletedAt: Date | null; lat: number; lng: number } }, now = new Date()): string[] {
  const reasons: string[] = [];
  if (row.property.publicationStatus !== "PUBLISHED") reasons.push("PROPERTY_PRIVATE");
  if (row.property.deletedAt) reasons.push("PROPERTY_DELETED");
  if (!row.publishedAt) reasons.push("LISTING_UNPUBLISHED");
  else if (row.publishedAt > now) reasons.push("LISTING_SCHEDULED");
  if (row.expiresAt && row.expiresAt <= now) reasons.push("LISTING_EXPIRED");
  if (row.availabilityStatus === "WITHDRAWN") reasons.push("LISTING_WITHDRAWN");
  if (!validMapPoint(row.property.lat, row.property.lng)) reasons.push("INVALID_COORDINATES");
  return reasons;
}

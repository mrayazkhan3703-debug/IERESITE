/** Shared CMS/API publication checks. This validates recorded fields, not their provenance. */
export interface PropertyPublicationInput {
  title: string; propertyType: string; bedrooms: number; bathrooms: number; lat: number; lng: number;
  communityStatus: string; projectSelected: boolean; projectPublic: boolean;
  listingType: string; rentFrequency?: string | null;
  listings: { pricePositive: boolean; availability: string; publishedAt: Date | null; expiresAt: Date | null }[];
}
export function propertyPublicationChecks(input: PropertyPublicationInput, now = new Date()) {
  const listing = input.listings.some(row => row.pricePositive && Boolean(row.availability) && row.availability !== "WITHDRAWN"
    && row.publishedAt !== null && row.publishedAt <= now && (row.expiresAt === null || row.expiresAt > now));
  return [
    { path: "title", message: "A title and property type are required.", ready: Boolean(input.title.trim() && input.propertyType.trim()) },
    { path: "bedrooms", message: "Bedroom and bathroom counts must be finite numbers between 0 and 30.", ready: [input.bedrooms, input.bathrooms].every(n => Number.isFinite(n) && n >= 0 && n <= 30) },
    { path: "lat", message: "Valid latitude and longitude are required.", ready: Number.isFinite(input.lat) && input.lat >= -90 && input.lat <= 90 && Number.isFinite(input.lng) && input.lng >= -180 && input.lng <= 180 },
    { path: "communityId", message: "The linked community must be published.", ready: input.communityStatus === "PUBLISHED" },
    { path: "projectId", message: "The linked project and its community must be published.", ready: !input.projectSelected || input.projectPublic },
    { path: "availabilityStatus", message: "A current, published, priced listing that is not withdrawn is required.", ready: listing },
    { path: "expiresAt", message: "Listing expiry must be in the future when supplied.", ready: input.listings.some(row => row.expiresAt === null || row.expiresAt > now) },
    { path: "listingType", message: "Choose a supported listing type and a rent frequency for rentals.", ready: ["SALE", "RENT", "SHORT_TERM"].includes(input.listingType) && (input.listingType !== "RENT" || ["YEARLY", "MONTHLY", "WEEKLY", "DAILY"].includes(input.rentFrequency ?? "")) },
  ];
}

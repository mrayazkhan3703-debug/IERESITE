/** Shared field names; browser mapping never guesses company facts. */
export const INVENTORY_IMPORT_FIELDS = ["externalId", "title", "community", "project", "developer", "propertyType", "listingType", "rentFrequency", "bedrooms", "bathrooms", "areaSqft", "priceAed", "offPlan", "availability", "lat", "lng", "view", "furnishing", "handover", "description", "agentEmail", "sourceUpdatedAt"] as const;
export type InventoryImportField = typeof INVENTORY_IMPORT_FIELDS[number];
export const REQUIRED_INVENTORY_IMPORT_FIELDS = ["externalId", "title", "community", "priceAed"] as const;
export function canonicalInventoryHeader(header: string): InventoryImportField | undefined {
  const key = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return INVENTORY_IMPORT_FIELDS.find(field => field.toLowerCase() === key);
}

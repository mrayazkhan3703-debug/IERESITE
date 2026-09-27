export type CatalogJsonRecord = Record<string, unknown>;

export function parseCatalogJson(raw: string | null | undefined): CatalogJsonRecord {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as CatalogJsonRecord : {};
  } catch {
    return {};
  }
}

const PROPERTY_SOURCE_KEYS = ["title", "description", "propertyType", "bedrooms", "bathrooms", "areaSqft", "lat", "lng", "view", "furnishing", "handover", "sourceUpdatedAt"] as const;
const LISTING_SOURCE_KEYS = ["listingType", "priceAed", "availability", "offPlan"] as const;
const EDITOR_OVERRIDE_KEYS = ["title", "description", "propertyType", "bedrooms", "bathrooms", "priceAed", "availability", "availabilityStatus"] as const;

function pickKeys(record: CatalogJsonRecord, keys: readonly string[]): CatalogJsonRecord {
  return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(record, key)).map((key) => [key, record[key]]));
}

/** Deliberately excludes source identifiers, agent email, and unreviewed arbitrary provider payload. */
export function adminCatalogSourceView(input: {
  propertySourceSnapshotJson: string | null;
  propertyEditorOverridesJson: string | null;
  listingSourceSnapshotJson?: string | null;
  listingEditorOverridesJson?: string | null;
}) {
  const propertySource = parseCatalogJson(input.propertySourceSnapshotJson);
  const listingSource = parseCatalogJson(input.listingSourceSnapshotJson);
  const propertyOverrides = parseCatalogJson(input.propertyEditorOverridesJson);
  const listingOverrides = parseCatalogJson(input.listingEditorOverridesJson);
  const sourceFacts = { ...pickKeys(propertySource, PROPERTY_SOURCE_KEYS), ...pickKeys(listingSource, LISTING_SOURCE_KEYS) };
  if (Object.prototype.hasOwnProperty.call(listingSource, "availability")) sourceFacts.availabilityStatus = listingSource.availability;
  const editorOverrides = { ...pickKeys(propertyOverrides, EDITOR_OVERRIDE_KEYS), ...pickKeys(listingOverrides, EDITOR_OVERRIDE_KEYS) };
  if (!Object.prototype.hasOwnProperty.call(editorOverrides, "availabilityStatus") && Object.prototype.hasOwnProperty.call(editorOverrides, "availability")) {
    editorOverrides.availabilityStatus = editorOverrides.availability;
  }
  delete editorOverrides.availability;
  return {
    sourceFacts,
    editorOverrides,
  };
}

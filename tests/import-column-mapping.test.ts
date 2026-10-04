import { describe, expect, test } from "bun:test";
import { getConfiguredIngestionAdapter, getUploadIngestionAdapter } from "@/server/ingestion/adapters";
import { serializeColumnMapping, columnMappingSchema, mapInventoryColumns } from "@/server/ingestion/column-mapping";
import { feedRecordSchema } from "@/server/ingestion/feed-record";
import { INVENTORY_IMPORT_FIELDS } from "@/lib/inventory-import-fields";
import { requireReviewedImport } from "@/server/ingestion/preview-approval";
const mapping = { externalId: "Reference", title: "Property Name", community: "District", priceAed: "Price AED", bedrooms: "Beds" };
async function* bytes(text: string) { yield text; }
describe("reviewed company column mapping", () => {
  test("shared fields match the canonical contract", () => {
    expect([...INVENTORY_IMPORT_FIELDS].sort().join(",")).toBe(Object.keys(feedRecordSchema.shape).sort().join(","));
  });
  test("serializes deterministically and rejects duplicate, unsafe and unknown columns", () => {
    expect(serializeColumnMapping(mapping)).toBe(serializeColumnMapping(Object.fromEntries(Object.entries(mapping).reverse())));
    for (const value of [{}, { externalId: "Same", title: "Same" }, { title: "__proto__" }, { invalidField: "Name" }]) expect(() => columnMappingSchema.parse(value)).toThrow();
  });
  test("maps raw CSV columns, quoted data and numeric values while preserving leading zeros", async () => {
    const adapter = getUploadIngestionAdapter("CSV", serializeColumnMapping(mapping));
    const results = [];
    for await (const raw of adapter.parse(bytes('Reference,Property Name,District,Price AED,Beds,Private note\n0001,"Harbor, View",Marina,1250000,2,ignored\n'))) results.push(adapter.normalize(raw));
    expect(results).toEqual([{ externalId: "0001", title: "Harbor, View", community: "Marina", priceAed: 1250000, bedrooms: 2 }]);
    expect(adapter.validate(results[0]).valid).toBe(true);
    expect(adapter.key).toBe("iere.mapped-property-csv");
  });
  test("maps JSON without guessing missing facts or changing input", async () => {
    const raw = { Reference: "0042", "Property Name": "Synthetic test only", District: "Test District", "Price AED": "12,500", Beds: "2" };
    const before = JSON.stringify(raw);
    const normalized = mapInventoryColumns(raw, mapping);
    expect(JSON.stringify(raw)).toBe(before);
    expect(normalized.priceAed).toBe("12,500");
    expect(getUploadIngestionAdapter("JSON", serializeColumnMapping(mapping)).validate(normalized).valid).toBe(false);
    expect(mapInventoryColumns({}, mapping)).toHaveProperty("externalId", undefined);
  });
  test("requires the recorded mapping and exact mapped adapter version", () => {
    expect(() => getConfiguredIngestionAdapter("iere.mapped-property-csv", 1, null)).toThrow();
    expect(() => getConfiguredIngestionAdapter("iere.mapped-property-json", 2, serializeColumnMapping(mapping))).toThrow();
    expect(() => getConfiguredIngestionAdapter("iere.canonical-property-csv", 1, serializeColumnMapping(mapping))).toThrow();
    expect(getUploadIngestionAdapter("CSV", null).key).toBe("iere.canonical-property-csv");
  });
  test("approval binds the source, actor, format, mapping and adapter version", () => {
    const mappingJson = serializeColumnMapping(mapping);
    const preview = { dryRun: true, status: "DRY_RUN", triggeredBy: "owner@example.invalid", snapshotSha256: "a".repeat(64), inputFormat: "CSV", recordsTotal: 1, recordCursor: 1, mappingJson, adapterKey: "iere.mapped-property-csv", adapterVersion: 1 };
    const input = { email: preview.triggeredBy, sha256: preview.snapshotSha256, format: "CSV", mappingJson, adapterKey: preview.adapterKey, adapterVersion: 1 };
    expect(() => requireReviewedImport(preview, input)).not.toThrow();
    for (const changed of [{ ...input, mappingJson: null }, { ...input, mappingJson: serializeColumnMapping({ ...mapping, priceAed: "Other price" }) }, { ...input, adapterVersion: 2 }, { ...input, adapterKey: "iere.canonical-property-csv" }]) expect(() => requireReviewedImport(preview, changed)).toThrow("does not match");
  });
});

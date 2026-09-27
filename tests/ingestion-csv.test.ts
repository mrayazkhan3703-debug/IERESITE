import { describe, expect, test } from "bun:test";
import { parseCsv, parseCsvStream, CsvParseError } from "@/server/ingestion/csv";
import { acquiredSnapshotSchema, getCanonicalAdapterForFormat, getIngestionAdapter, JsonParseError, UnsupportedIngestionAdapterError } from "@/server/ingestion/adapters";

async function* chunks(parts: Array<string | Uint8Array>) {
  for (const part of parts) yield part;
}

describe("streaming ingestion CSV parser", () => {
  test("handles chunk boundaries, BOM, quoted commas/newlines, and preserves source IDs", async () => {
    const parsed = [];
    for await (const row of parseCsvStream(chunks([
      "\uFEFFexternal_id,title,community,bedrooms,price_aed,off_plan,description\r\n001",
      "23,\"Harbor, View\",Marina,2,1450000,yes,\"Line one\nLine two\"\r\n",
    ]))) parsed.push(row);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      externalId: "00123",
      title: "Harbor, View",
      community: "Marina",
      bedrooms: 2,
      priceAed: 1450000,
      offPlan: true,
      description: "Line one\nLine two",
    });
    expect(typeof parsed[0].externalId).toBe("string");
  });

  test("rejects duplicate canonical headers and malformed column counts", async () => {
    const inputs = [
      "external_id,externalId\n001,002\n",
      "external_id,title,community,price_aed\n001,Harbor View,Marina,1000000,unexpected\n",
      "external_id,title,community,price_aed\n001,Harbor View,Marina\n",
    ];

    for (const input of inputs) {
      await expect(parseCsv(input)).rejects.toBeInstanceOf(CsvParseError);
    }
  });

  test("rejects records larger than the configured parser bound", async () => {
    const oversized = `external_id,title,community,price_aed\n001,${"x".repeat(65_537)},Marina,1000000\n`;
    await expect(parseCsv(oversized)).rejects.toBeInstanceOf(CsvParseError);
  });

  test("returns no rows for empty/header-only feeds and stops at the requested limit", async () => {
    expect(await parseCsv("")).toEqual([]);
    expect(await parseCsv("external_id,title\n")).toEqual([]);
    expect(await parseCsv("external_id,title\n001,First\n002,Second\n", 1)).toHaveLength(1);
  });

  test("uses an exact adapter version and reports normalized validation outcomes", () => {
    const adapter = getIngestionAdapter("iere.canonical-property-csv", 1);
    const normalized = adapter.normalize({
      externalId: "00042",
      title: "Harbor View",
      community: "Marina",
      priceAed: 1450000,
      providerOnlyNote: "not a canonical mapping",
    });
    const validation = adapter.validate(normalized);

    expect(normalized).not.toHaveProperty("providerOnlyNote");
    expect(validation.valid).toBe(true);
    if (validation.valid) {
      expect(validation.record.externalId).toBe("00042");
      expect(validation.record.bedrooms).toBe(0);
      expect(validation.record.offPlan).toBe(false);
    }
    expect(() => getIngestionAdapter("iere.canonical-property-csv", 2)).toThrow(UnsupportedIngestionAdapterError);
  });

  test("requires durable snapshot identity and a SHA-256 content digest", () => {
    const snapshot = acquiredSnapshotSchema.parse({
      sourceKey: "unit-test-source",
      format: "CSV",
      sourceVersion: null,
      retrievedAt: new Date("2026-09-23T00:00:00.000Z"),
      sha256: "a".repeat(64),
      storageRef: "imports/unit-test/snapshot.csv",
      adapterKey: "iere.canonical-property-csv",
      adapterVersion: 1,
    });
    expect(snapshot.sourceKey).toBe("unit-test-source");
    expect(() => acquiredSnapshotSchema.parse({ ...snapshot, sha256: "not-a-digest" })).toThrow();
  });

  test("parses canonical JSON arrays under the interactive cap and rejects malformed or oversized arrays", async () => {
    const adapter = getCanonicalAdapterForFormat("JSON");
    const bytes = new TextEncoder().encode('[{"externalId":"0007","title":"Synthetic JSON Home","community":"Unit Community","priceAed":1000000}]');
    const rows = [];
    for await (const row of adapter.parse(chunks([bytes]))) rows.push(adapter.validate(adapter.normalize(row)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valid).toBe(true);
    if (rows[0]?.valid) expect(rows[0].record.externalId).toBe("0007");

    const drain = async (input: string) => {
      for await (const _row of adapter.parse(chunks([input]))) { /* drain parser */ }
    };
    await expect(drain("not-json")).rejects.toBeInstanceOf(JsonParseError);
    const tooMany = JSON.stringify(Array.from({ length: 501 }, () => null));
    await expect(drain(tooMany)).rejects.toBeInstanceOf(JsonParseError);
  });
});

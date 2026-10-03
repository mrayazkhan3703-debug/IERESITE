import { parse as csvParse } from "csv-parse";
import { Readable } from "node:stream";
import { canonicalInventoryHeader } from "@/lib/inventory-import-fields";

const numericFeedFields = new Set(["bedrooms", "bathrooms", "areaSqft", "priceAed", "lat", "lng"]);

export class CsvParseError extends Error {
  constructor() {
    super("CSV input is malformed or exceeds the supported record size.");
    this.name = "CsvParseError";
  }
}

function normalizeFeedHeader(header: string): string {
  const trimmed = header.trim();
  return canonicalInventoryHeader(trimmed) ?? trimmed;
}

/** Parse streamed CSV using only canonical feed field names and types. */
export async function* parseCsvStream(
  chunks: AsyncIterable<string | Uint8Array>,
  rawColumns = false,
): AsyncGenerator<Record<string, unknown>> {
  const parser = csvParse({
    bom: true,
    columns(headers) {
      const normalized = headers.map(header => rawColumns ? header.trim() : normalizeFeedHeader(header));
      const seen = new Set<string>();
      for (const header of normalized) {
        const duplicateKey = header.trim().toLowerCase();
        if (!duplicateKey || seen.has(duplicateKey)) throw new Error("Duplicate or empty CSV header");
        seen.add(duplicateKey);
      }
      return normalized;
    },
    skip_empty_lines: true,
    trim: true,
    max_record_size: 64 * 1024,
    relax_column_count: false,
    cast(value, context) {
      if (context.header) return value;
      const column = typeof context.column === "string" ? context.column : "";
      if (value === "") return undefined;
      if (rawColumns) return value;
      if (column === "externalId") return value;
      if (numericFeedFields.has(column) && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number(value);
      if (column === "offPlan") {
        if (/^(?:true|yes|1)$/i.test(value)) return true;
        if (/^(?:false|no|0)$/i.test(value)) return false;
      }
      return value;
    },
  });

  try {
    for await (const record of Readable.from(chunks).pipe(parser)) {
      yield record as Record<string, unknown>;
    }
  } catch {
    throw new CsvParseError();
  }
}

/** Bounded compatibility adapter for callers with CSV text already in memory. */
export async function parseCsv(text: string, maxRecords = Number.MAX_SAFE_INTEGER): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const record of parseCsvStream(Readable.from([text]))) {
    records.push(record);
    if (records.length >= maxRecords) break;
  }
  return records;
}

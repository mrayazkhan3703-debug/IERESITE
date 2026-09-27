import { z } from "zod";
import { parseCsvStream } from "./csv";
import { feedRecordSchema, type FeedRecord } from "./feed-record";

export const CANONICAL_CSV_ADAPTER_KEY = "iere.canonical-property-csv";
export const CANONICAL_CSV_ADAPTER_VERSION = 1;
export const CANONICAL_JSON_ADAPTER_KEY = "iere.canonical-property-json";
export const CANONICAL_JSON_ADAPTER_VERSION = 1;

/** Immutable description of the exact source bytes used by an import run. */
export const acquiredSnapshotSchema = z.object({
  sourceKey: z.string().trim().min(1).max(160),
  format: z.enum(["CSV", "JSON"]),
  sourceVersion: z.string().trim().max(200).nullable(),
  retrievedAt: z.date(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  storageRef: z.string().trim().min(1).max(500),
  adapterKey: z.string().trim().min(1).max(160),
  adapterVersion: z.number().int().positive(),
});

export type AcquiredSnapshot = z.infer<typeof acquiredSnapshotSchema>;
export interface AcquiredSnapshotStream {
  metadata: AcquiredSnapshot;
  chunks: AsyncIterable<string | Uint8Array>;
}

/** Implemented by a configured source connector; no live provider is assumed. */
export interface SourceAcquisitionAdapter<TRequest = unknown> {
  readonly key: string;
  readonly version: number;
  acquire(request: TRequest): Promise<AcquiredSnapshotStream>;
}

export type FeedValidationIssue = { path: string; code: string; message: string };
export type FeedValidation =
  | { valid: true; record: FeedRecord; issues: [] }
  | { valid: false; record: null; issues: FeedValidationIssue[] };

export interface VersionedIngestionAdapter {
  readonly key: string;
  readonly version: number;
  readonly format: "CSV" | "JSON";
  parse(chunks: AsyncIterable<string | Uint8Array>): AsyncIterable<Record<string, unknown>>;
  normalize(raw: Record<string, unknown>): Record<string, unknown>;
  validate(normalized: Record<string, unknown>): FeedValidation;
}

const canonicalFeedFields = new Set(Object.keys(feedRecordSchema.shape));
const normalizeCanonicalFields = (raw: Record<string, unknown>) => Object.fromEntries(
  Object.entries(raw).filter(([field]) => canonicalFeedFields.has(field)),
);
const validateCanonicalFields = (normalized: Record<string, unknown>): FeedValidation => {
  const result = feedRecordSchema.safeParse(normalized);
  if (result.success) return { valid: true, record: result.data, issues: [] };
  return {
    valid: false,
    record: null,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })),
  };
};

/**
 * Provider-neutral CSV v1. Header matching is limited to canonical feed field
 * names; provider-specific aliases must live in a separately versioned adapter
 * backed by approved source documentation.
 */
export const canonicalCsvAdapter: VersionedIngestionAdapter = {
  key: CANONICAL_CSV_ADAPTER_KEY,
  version: CANONICAL_CSV_ADAPTER_VERSION,
  format: "CSV",
  parse: parseCsvStream,
  normalize: normalizeCanonicalFields,
  validate: validateCanonicalFields,
};

export class JsonParseError extends Error {
  constructor() {
    super("JSON import input must be a valid array of at most 500 records.");
    this.name = "JsonParseError";
  }
}

async function* parseCanonicalJson(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let text = "";
  let sizeBytes = 0;
  try {
    for await (const chunk of chunks) {
      sizeBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (sizeBytes > 50 * 1024 * 1024) throw new JsonParseError();
      text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    const records: unknown = JSON.parse(text);
    if (!Array.isArray(records) || records.length > 500) throw new JsonParseError();
    for (const record of records) {
      if (record && typeof record === "object" && !Array.isArray(record)) yield record as Record<string, unknown>;
      else yield { invalidInputRecord: true };
    }
  } catch {
    throw new JsonParseError();
  }
}

export const canonicalJsonAdapter: VersionedIngestionAdapter = {
  key: CANONICAL_JSON_ADAPTER_KEY,
  version: CANONICAL_JSON_ADAPTER_VERSION,
  format: "JSON",
  parse: parseCanonicalJson,
  normalize: normalizeCanonicalFields,
  validate: validateCanonicalFields,
};

const adapterVersions = new Map<string, VersionedIngestionAdapter>([
  [`${canonicalCsvAdapter.key}@${canonicalCsvAdapter.version}`, canonicalCsvAdapter],
  [`${canonicalJsonAdapter.key}@${canonicalJsonAdapter.version}`, canonicalJsonAdapter],
]);

export class UnsupportedIngestionAdapterError extends Error {
  constructor(key: string, version: number) {
    super(`Ingestion adapter ${key}@${version} is not registered.`);
    this.name = "UnsupportedIngestionAdapterError";
  }
}

/** Resolve the exact recorded adapter version; never silently upgrade runs. */
export function getIngestionAdapter(key: string, version: number): VersionedIngestionAdapter {
  const adapter = adapterVersions.get(`${key}@${version}`);
  if (!adapter) throw new UnsupportedIngestionAdapterError(key, version);
  return adapter;
}

export function getCanonicalAdapterForFormat(format: "CSV" | "JSON"): VersionedIngestionAdapter {
  return format === "CSV" ? canonicalCsvAdapter : canonicalJsonAdapter;
}

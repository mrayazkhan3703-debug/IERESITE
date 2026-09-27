import { createHash } from "node:crypto";
import { putPrivateObject, getPrivateObjectStream } from "@/server/storage/object-store";
import { acquiredSnapshotSchema, getCanonicalAdapterForFormat, getIngestionAdapter, type AcquiredSnapshot } from "./adapters";

export const MAX_IMPORT_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const SNAPSHOT_KEY_PATTERN = /^private\/imports\/[a-f0-9]{24}\/[a-f0-9]{64}\.(csv|json)$/;

export class SnapshotIntegrityError extends Error {
  constructor() {
    super("The stored import snapshot failed integrity verification.");
    this.name = "SnapshotIntegrityError";
  }
}

async function hashStoredObject(key: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of getPrivateObjectStream(key)) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > MAX_IMPORT_SNAPSHOT_BYTES) throw new SnapshotIntegrityError();
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

/** Persist source bytes privately under a content-addressed key and verify the stored copy. */
export async function persistImportSnapshot(input: {
  sourceKey: string;
  sourceVersion?: string | null;
  format: "CSV" | "JSON";
  bytes: Uint8Array;
}): Promise<AcquiredSnapshot> {
  const sourceKey = input.sourceKey.trim();
  if (!sourceKey || sourceKey.length > 160) throw new Error("A bounded source key is required");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMPORT_SNAPSHOT_BYTES) {
    throw new Error("Import snapshots must contain between 1 byte and 50 MiB");
  }

  const adapter = getCanonicalAdapterForFormat(input.format);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const sourcePathKey = createHash("sha256").update(sourceKey).digest("hex").slice(0, 24);
  const extension = input.format.toLowerCase();
  const storageRef = `private/imports/${sourcePathKey}/${sha256}.${extension}`;

  await putPrivateObject({
    key: storageRef,
    body: Buffer.from(input.bytes),
    contentType: input.format === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
  });

  const stored = await hashStoredObject(storageRef);
  if (stored.sha256 !== sha256 || stored.sizeBytes !== input.bytes.byteLength) throw new SnapshotIntegrityError();

  return acquiredSnapshotSchema.parse({
    sourceKey,
    format: input.format,
    sourceVersion: input.sourceVersion?.trim() || null,
    retrievedAt: new Date(),
    sha256,
    storageRef,
    adapterKey: adapter.key,
    adapterVersion: adapter.version,
  });
}

/** Verify immutable content before returning a fresh stream for parsing. */
export async function openVerifiedImportSnapshot(snapshotInput: AcquiredSnapshot): Promise<AsyncIterable<Uint8Array>> {
  const snapshot = acquiredSnapshotSchema.parse(snapshotInput);
  if (!SNAPSHOT_KEY_PATTERN.test(snapshot.storageRef) || !snapshot.storageRef.endsWith(`/${snapshot.sha256}.${snapshot.format.toLowerCase()}`)) {
    throw new SnapshotIntegrityError();
  }
  getIngestionAdapter(snapshot.adapterKey, snapshot.adapterVersion);
  const stored = await hashStoredObject(snapshot.storageRef);
  if (stored.sha256 !== snapshot.sha256) throw new SnapshotIntegrityError();
  return getPrivateObjectStream(snapshot.storageRef);
}

export function persistCsvSnapshot(input: Omit<Parameters<typeof persistImportSnapshot>[0], "format">) {
  return persistImportSnapshot({ ...input, format: "CSV" });
}

export function openVerifiedCsvSnapshot(snapshot: AcquiredSnapshot) {
  if (snapshot.format !== "CSV") throw new SnapshotIntegrityError();
  return openVerifiedImportSnapshot(snapshot);
}

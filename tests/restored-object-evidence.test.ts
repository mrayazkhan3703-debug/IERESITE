import { expect, test } from "bun:test";
import { validateObjectEvidence, validateRestoreManifest } from "../scripts/verify-restored-objects.mjs";

test("restore manifest requires fixed artifact and pinned image/hash metadata", () => {
  const valid = { format: 1, source: "local-docker-compose", images: { seaweedImageId: `sha256:${"a".repeat(64)}` },
    objectStorage: { file: "object-storage.tar.gz", sha256: "b".repeat(64) } };
  expect(() => validateRestoreManifest(valid)).not.toThrow();
  expect(() => validateRestoreManifest({ ...valid, objectStorage: { ...valid.objectStorage, file: "../../.env" } })).toThrow();
  expect(() => validateRestoreManifest({ ...valid, images: { seaweedImageId: "latest" } })).toThrow();
});

test("empty/unbounded or fabricated restored-object evidence fails closed", () => {
  const valid = { objectCount: 1, totalBytes: 32, etagVerified: 1, inventorySha256: "a".repeat(64) };
  expect(() => validateObjectEvidence(valid)).not.toThrow();
  expect(() => validateObjectEvidence({ ...valid, objectCount: 0 })).toThrow();
  expect(() => validateObjectEvidence({ ...valid, objectCount: 201 })).toThrow();
  expect(() => validateObjectEvidence({ ...valid, etagVerified: 2 })).toThrow();
  expect(() => validateObjectEvidence({ ...valid, totalBytes: 257 * 1024 * 1024 })).toThrow();
});

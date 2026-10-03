import { expect, test } from "bun:test";
import { reconcileMediaInventory, storedOriginalChecksum } from "../scripts/reconcile-media-inventory.mjs";
const key = "public/media/fixture.jpg", snapshotRef = `private/imports/${"a".repeat(24)}/${"b".repeat(64)}.csv`;
const inventory = () => ({ capturedAtUtc: new Date().toISOString(), media: [
  { id: "image", storageKey: key, mimeType: "image/jpeg", isPrivate: false, sizeBytes: 7, checksum: "b".repeat(64), storageChecksum: "a".repeat(64) as string | null, variantsJson: '{"thumb":{}}' },
  { id: "document", storageKey: "private/portfolio/fixture.pdf", mimeType: "application/pdf", isPrivate: true, sizeBytes: 9, variantsJson: null },
  { id: "bundled", storageKey: "static/images/team/fixture.jpg", mimeType: "image/jpeg", isPrivate: false, sizeBytes: 8, variantsJson: null },
], imports: [{ snapshotRef }] });
const copy = () => ({ complete: true, copied: true, prefix: "railway-main", objects: [key, `${key}.thumb.webp`, "private/portfolio/fixture.pdf", snapshotRef].map((key, index) => ({ key, destinationKey: `railway-main/${key}`, bytes: index === 2 ? 9 : 7, sha256: "a".repeat(64), verified: true })) });
test("full reconciliation includes private documents, derivatives and retained imports without treating bundled images as objects", () => {
  const result = reconcileMediaInventory(inventory(), copy());
  expect(result.status).toBe("PASS_COPIED_REFERENCES"); expect(result.privateMediaAssets).toBe(1);
  expect(result.retainedImportSnapshots).toBe(1); expect(result.objectReferences).toBe(4); expect(result.staticReferences).toBe(1);
  expect(result.backupAcceptance).toBe("NOT_VERIFIED"); expect(result.deletionEnabled).toBe(false);
});
test("missing private bytes and size mismatches block cutover; unreferenced copies remain untouched", () => {
  const incomplete = copy(); incomplete.objects.splice(2, 1);
  expect(reconcileMediaInventory(inventory(), incomplete).issues[0].reason).toBe("REFERENCED_OBJECT_NOT_COPIED");
  const changed = copy(); changed.objects[0].bytes = 8;
  expect(reconcileMediaInventory(inventory(), changed).issues[0].reason).toBe("ORIGINAL_SIZE_MISMATCH");
  const corrupted = copy(); corrupted.objects[0].sha256 = "b".repeat(64);
  expect(reconcileMediaInventory(inventory(), corrupted).issues[0].reason).toBe("ORIGINAL_CHECKSUM_MISMATCH");
  const extra = copy(); extra.objects.push({ key: "public/media/retained.jpg", destinationKey: "railway-main/public/media/retained.jpg", bytes: 3, sha256: "a".repeat(64), verified: true });
  expect(reconcileMediaInventory(inventory(), extra).unreferencedCopiedObjects).toBe(1);
});
test("partial, duplicate and unverified copy receipts are refused", () => {
  expect(() => reconcileMediaInventory(inventory(), { ...copy(), complete: false })).toThrow();
  const duplicate = copy(); duplicate.objects.push(duplicate.objects[0]);
  expect(() => reconcileMediaInventory(inventory(), duplicate)).toThrow("INVALID_VERIFIED_COPY");
  const unverified = copy(); unverified.objects[0].verified = false;
  expect(() => reconcileMediaInventory(inventory(), unverified)).toThrow("INVALID_VERIFIED_COPY");
  const wrongNamespace = copy(); wrongNamespace.objects[0].destinationKey = `another-company/${key}`;
  expect(() => reconcileMediaInventory(inventory(), wrongNamespace)).toThrow("INVALID_VERIFIED_COPY");
});

test("legacy image source hashes are preserved without pretending they identify sanitized storage bytes", () => {
  const legacy = inventory(); legacy.media[0].storageChecksum = null;
  const result = reconcileMediaInventory(legacy, copy());
  expect(result.status).toBe("PASS_COPIED_REFERENCES");
  expect(result.legacyImagesWithoutStoredChecksum).toBe(1);
  expect(legacy.media[0].checksum).toBe("b".repeat(64));
  expect(storedOriginalChecksum(legacy.media[0])).toBeNull();
  expect(storedOriginalChecksum({ mimeType: "application/pdf", checksum: "c".repeat(64) })).toBe("c".repeat(64));
});

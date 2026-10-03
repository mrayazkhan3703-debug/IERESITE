import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mediaObjectReferences, importObjectReferences } from "./backup-hosted.mjs";
import { staticMediaKey } from "./backup-source-policy.mjs";

const fail = code => { throw new Error(code); };
// Images are sanitized before storage. Their legacy source hash must never be
// reclassified as a stored hash or overwritten just to make a cutover pass.
export function storedOriginalChecksum(asset) {
  if (/^[a-f0-9]{64}$/.test(asset?.storageChecksum ?? "")) return asset.storageChecksum;
  if (!asset?.mimeType?.startsWith("image/") && /^[a-f0-9]{64}$/.test(asset?.checksum ?? "")) return asset.checksum;
  return null;
}
export function reconcileMediaInventory(inventory, copy) {
  if (!Array.isArray(inventory?.media) || !Array.isArray(inventory?.imports) ||
    !Number.isFinite(Date.parse(inventory.capturedAtUtc)) || copy?.complete !== true || copy?.copied !== true ||
    !Array.isArray(copy.objects) || copy.objects.length > 20000 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(copy.prefix ?? "")) fail("INVALID_RECONCILIATION_INPUT");
  const references = [...mediaObjectReferences(inventory.media), ...importObjectReferences(inventory.imports)];
  const objects = new Map();
  for (const object of copy.objects) {
    if (typeof object.key !== "string" || objects.has(object.key) || !Number.isSafeInteger(object.bytes) || object.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(object.sha256 ?? "") || object.verified !== true ||
      object.destinationKey !== `${copy.prefix}/${object.key}` || object.key.startsWith("/") || object.key.includes("\\") ||
      object.key.split("/").some(part => !part || part === "." || part === "..")) fail("INVALID_VERIFIED_COPY");
    objects.set(object.key, object);
  }
  const issues = [], assets = new Map(inventory.media.map(asset => [asset.id, asset]));
  let staticReferences = 0;
  for (const ref of references) {
    if (staticMediaKey(ref.key)) { staticReferences++; continue; }
    const copied = objects.get(ref.key);
    if (!copied) issues.push({ assetId: ref.assetId, key: ref.key, reason: "REFERENCED_OBJECT_NOT_COPIED" });
    else if (!ref.variant && Number.isSafeInteger(assets.get(ref.assetId)?.sizeBytes) && copied.bytes !== assets.get(ref.assetId).sizeBytes) {
      issues.push({ assetId: ref.assetId, key: ref.key, reason: "ORIGINAL_SIZE_MISMATCH" });
    } else if (!ref.variant && storedOriginalChecksum(assets.get(ref.assetId)) && copied.sha256 !== storedOriginalChecksum(assets.get(ref.assetId))) {
      issues.push({ assetId: ref.assetId, key: ref.key, reason: "ORIGINAL_CHECKSUM_MISMATCH" });
    }
  }
  const referencedKeys = new Set(references.map(ref => ref.key));
  return { status: issues.length ? "BLOCKED_REFERENCE_RECONCILIATION" : "PASS_COPIED_REFERENCES",
    checkedAtUtc: new Date().toISOString(), databaseInventoryAtUtc: inventory.capturedAtUtc, sourceId: "railway-main", prefix: copy.prefix,
    mediaAssets: inventory.media.length, privateMediaAssets: inventory.media.filter(row => row.isPrivate).length,
    retainedImportSnapshots: inventory.imports.length, objectReferences: references.length - staticReferences,
    staticReferences, staticVerification: "RELEASE_BUNDLE_AND_RECOVERY_REQUIRED", issues,
    legacyImagesWithoutStoredChecksum: inventory.media.filter(asset => !staticMediaKey(asset.storageKey) && asset.mimeType?.startsWith("image/") && !storedOriginalChecksum(asset)).length,
    checksumScope: "Source upload hashes are preserved. Legacy sanitized images are verified by source-to-destination full-byte SHA-256 equality and recorded size; prior stored-file baseline hashes were not recorded.",
    unreferencedCopiedObjects: copy.objects.filter(row => !referencedKeys.has(row.key)).length,
    deletionEnabled: false, backupAcceptance: "NOT_VERIFIED", consistency: "Snapshot reference inventory compared with full-byte verified copy. Refresh before cutover; no writes or backup claim." };
}
async function inputFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 32 * 1024 ** 2) fail("INVALID_INPUT_FILE");
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (async () => {
    const [inventoryPath, copyPath, receiptPath] = process.argv.slice(2);
    const result = reconcileMediaInventory(await inputFile(inventoryPath), await inputFile(copyPath));
    await writeFile(receiptPath, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, mediaAssets: result.mediaAssets, privateMediaAssets: result.privateMediaAssets,
      retainedImportSnapshots: result.retainedImportSnapshots, issues: result.issues.length }));
    if (result.issues.length) process.exitCode = 1;
  })().catch(() => { console.error('{"status":"FAILED_RECONCILIATION","details":"redacted"}'); process.exitCode = 1; });
}

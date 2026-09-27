import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const policyPath = fileURLToPath(new URL("../docs/agent/RECOVERY_TARGETS.json", import.meta.url));
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archiveLimit = 64 * 1024 ** 3;
const unresolved = [
  "Backup cadence and failed-run alerting",
  "Recoverable data freshness / achieved RPO",
  "Real object reads and full incident-to-service RTO",
  "Protected off-host copies, encryption/key recovery and retention",
];

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) {
    throw new Error("INVALID_BACKUP_TIMESTAMP");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error("INVALID_BACKUP_TIMESTAMP");
  }
  return ms;
}

export function assessBackupMetadata(manifest, policy, nowMs = Date.now()) {
  if (!policy || policy.format !== 1 || policy.status !== "OWNER_APPROVED_TARGETS_ONLY" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(policy.approvedOn ?? "") ||
      ![policy.rpoSeconds, policy.rtoSeconds].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647)) {
    throw new Error("INVALID_RECOVERY_POLICY");
  }
  timestamp(`${policy.approvedOn}T00:00:00Z`);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("INVALID_CHECK_TIME");
  if (!manifest || manifest.format !== 1 || manifest.source !== "local-docker-compose" || manifest.syntheticFixture === true) {
    throw new Error("INVALID_BACKUP_SCOPE");
  }
  for (const [field, file] of [["database", "database.dump"], ["objectStorage", "object-storage.tar.gz"]]) {
    if (manifest[field]?.file !== file || !/^[a-f0-9]{64}$/i.test(manifest[field]?.sha256 ?? "")) {
      throw new Error("INVALID_ARCHIVE_METADATA");
    }
  }
  if (![manifest.images?.postgresImageId, manifest.images?.seaweedImageId]
    .every((v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v)) ||
      !/^\d{6}$/.test(String(manifest.database?.serverVersionNum ?? ""))) {
    throw new Error("INVALID_BACKUP_IMAGE_METADATA");
  }
  const started = timestamp(manifest.createdAtUtc);
  const completed = timestamp(manifest.completedAtUtc);
  if (started > completed || completed > nowMs) throw new Error("INVALID_BACKUP_TIME_ORDER");
  const recorded = manifest.approvedRecoveryTargets;
  if (recorded != null && (recorded.status !== policy.status || recorded.approvedOn !== policy.approvedOn ||
      recorded.rpoSeconds !== policy.rpoSeconds || recorded.rtoSeconds !== policy.rtoSeconds ||
      recorded.achievement !== "NOT_VERIFIED_BY_LOCAL_DRILL")) throw new Error("RECOVERY_TARGET_METADATA_MISMATCH");
  // Start time is deliberately conservative. Recent completion of an old dump
  // must not make its capture window appear fresh. Neither age proves RPO.
  const captureWindowAgeSeconds = (nowMs - started) / 1000;
  const withinTargetAge = captureWindowAgeSeconds <= policy.rpoSeconds;
  return {
    status: withinTargetAge ? "PASS_SCOPED" : "FAIL_BACKUP_AGE",
    checkedAtUtc: new Date(nowMs).toISOString(),
    scope: "Local archive integrity and conservative capture-window age only",
    targets: { rpoSeconds: policy.rpoSeconds, rtoSeconds: policy.rtoSeconds, approvedOn: policy.approvedOn },
    targetMetadata: recorded == null ? "LEGACY_MISSING_TARGET_METADATA" : "MATCHES_OFFICIAL_TARGETS",
    captureWindowAgeSeconds,
    completionAgeSeconds: (nowMs - completed) / 1000,
    withinTargetAge,
    achievedRpo: "NOT_VERIFIED",
    achievedRto: "NOT_VERIFIED",
    remainingEvidence: [...unresolved],
  };
}

async function fixedFile(directory, name, maxBytes) {
  const path = resolve(directory, name);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > maxBytes ||
      dirname(await realpath(path)) !== directory) throw new Error("INVALID_EVIDENCE_FILE");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = await handle.stat();
  if (!opened.isFile() || opened.size !== info.size || opened.ino !== info.ino || opened.dev !== info.dev) {
    await handle.close();
    throw new Error("EVIDENCE_FILE_CHANGED");
  }
  return { handle, size: opened.size };
}

async function jsonFile(directory, name, maxBytes) {
  const { handle } = await fixedFile(directory, name, maxBytes);
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("INVALID_EVIDENCE_FILE");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
  } finally { await handle.close(); }
}

async function archiveHash(directory, name) {
  const { handle, size } = await fixedFile(directory, name, archiveLimit);
  try {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > size) throw new Error("EVIDENCE_FILE_CHANGED");
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (bytes !== size || after.size !== size) throw new Error("EVIDENCE_FILE_CHANGED");
    return { hash: hash.digest("hex"), bytes };
  } finally { await handle.close(); }
}

export async function checkBackupDirectory(directory, policy, nowMs = Date.now()) {
  const requested = resolve(directory);
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("INVALID_BACKUP_DIRECTORY");
  }
  const root = await realpath(requested);
  try {
    await lstat(resolve(root, "INCOMPLETE.txt"));
    throw new Error("INCOMPLETE_BACKUP");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = await jsonFile(root, "manifest.json", 32_768);
  const report = assessBackupMetadata(manifest, policy, nowMs);
  const database = await archiveHash(root, "database.dump");
  const objects = await archiveHash(root, "object-storage.tar.gz");
  if (database.hash !== manifest.database.sha256.toLowerCase() || objects.hash !== manifest.objectStorage.sha256.toLowerCase()) {
    throw new Error("ARCHIVE_HASH_MISMATCH");
  }
  return { ...report, archives: { integrity: "SHA256_MATCH", databaseBytes: database.bytes, objectStorageBytes: objects.bytes },
    archiveFormats: "NOT_REVALIDATED", releaseGate: "OPEN" };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--backup-directory" || !args[1]) throw new Error("BACKUP_DIRECTORY_ARGUMENT_REQUIRED");
  const directory = await realpath(resolve(args[1]));
  const inside = relative(await realpath(workspace), directory);
  if (inside === "" || (!inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(inside))) {
    throw new Error("BACKUP_MUST_BE_OUTSIDE_WORKSPACE");
  }
  const policy = await jsonFile(dirname(policyPath), "RECOVERY_TARGETS.json", 4096);
  const report = await checkBackupDirectory(args[1], policy);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS_SCOPED") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // Never expose paths, manifest contents, archive bytes or exception payloads.
    console.error("Backup evidence check failed: missing, incomplete, invalid or mismatched evidence. No recovery success claimed.");
    process.exitCode = 1;
  });
}

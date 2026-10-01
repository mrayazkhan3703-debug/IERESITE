import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export const PART_BYTES = 16 * 1024 ** 2;
export const ARCHIVE_LIMIT = 64 * 1024 ** 3;
const CIPHER_LIMIT = ARCHIVE_LIMIT + 16 * 1024 ** 2;
const FILES = ["database.dump", "object-storage.tar.gz", "manifest.json"];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) fail("INVALID_TIMESTAMP");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) fail("INVALID_TIMESTAMP");
  return parsed;
}

async function safeFile(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > limit) fail("INVALID_FILE");
  return info;
}
async function jsonFile(path, limit) {
  await safeFile(path, limit);
  // Windows PowerShell 5.1's UTF8 manifests carry a BOM.
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}
export async function hashFile(path, limit = CIPHER_LIMIT) {
  const info = await safeFile(path, limit);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > limit) fail("FILE_TOO_LARGE");
    hash.update(chunk);
  }
  if (bytes !== info.size) fail("FILE_CHANGED");
  return { bytes, sha256: hash.digest("hex") };
}
export function validateConfig(value, fixture = false) {
  if (!value || value.format !== 1 || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket ?? "") ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value.prefix ?? "") ||
      typeof value.region !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.region) ||
      typeof value.forcePathStyle !== "boolean" ||
      ![value.recipientFile, value.credentialFile].every((v) => typeof v === "string" && isAbsolute(v))) fail("INVALID_CONFIG");
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { fail("INVALID_CONFIG"); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" ||
      (fixture ? endpoint.href !== "http://backup-fixture-store:8333/" : endpoint.protocol !== "https:")) fail("INVALID_ENDPOINT");
  const provider = value.provider ?? "s3-compatible";
  if (value.maxStoredBytes !== undefined && (!Number.isSafeInteger(value.maxStoredBytes) || value.maxStoredBytes < 1024 ** 2 || value.maxStoredBytes > ARCHIVE_LIMIT)) fail("INVALID_STORAGE_CAP");
  if (!["s3-compatible", "cloudflare-r2"].includes(provider)) fail("INVALID_PROVIDER");
  if (provider === "cloudflare-r2" && (fixture ||
      !/^[a-f0-9]{32}(?:\.(?:eu|fedramp|us))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
      endpoint.port || value.region !== "auto" || value.forcePathStyle !== true)) fail("INVALID_R2_CONFIG");
  return { ...value, provider, endpoint: endpoint.href };
}
export async function loadConfig(path, fixture = false) {
  return validateConfig(await jsonFile(path, 4096), fixture);
}
export function plan(config, now = Date.now()) {
  const checked = validateConfig(config);
  return { status: "PLAN_ONLY", encryption: "age-public-key", intervalMinutes: 30, retentionDays: 30,
    provider: checked.provider, destinationConfiguration: "RECORDED_NOT_LIVE_VERIFIED",
    bucketPrivacy: "NOT_VERIFIED", keyRecovery: "NOT_VERIFIED",
    networkCalls: 0, scheduledTaskEnabled: false, deletionAuthorized: false,
    destination: "BLOCKED_EXTERNAL", achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED",
    checkedAtUtc: new Date(now).toISOString() };
}
async function recipients(path) {
  await safeFile(path, 4096);
  const rows = (await readFile(path, "utf8")).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  // Deliberately only standard age X25519 public recipients; no identities/plugins.
  if (rows.length < 1 || rows.length > 8 || rows.some((s) => !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s))) fail("INVALID_RECIPIENTS");
  return { rows, fingerprint: sha([...new Set(rows)].sort().join("\n")) };
}
async function client(config) {
  const credentials = await jsonFile(config.credentialFile, 4096);
  if (![credentials.accessKeyId, credentials.secretAccessKey].every((s) => typeof s === "string" && s.length > 0 && s.length < 4096) ||
      (credentials.sessionToken !== undefined && typeof credentials.sessionToken !== "string")) fail("INVALID_CREDENTIAL_FILE");
  return new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
    credentials, maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 0, socketTimeout: 30000 },
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}
async function command(program, args, stdoutPath) {
  const output = stdoutPath ? await open(stdoutPath, "wx", 0o600) : null;
  try {
    await new Promise((done, reject) => {
      const proc = spawn(program, args, { stdio: ["ignore", output ? output.fd : "ignore", "ignore"], shell: false });
      const deadline = setTimeout(() => proc.kill("SIGKILL"), 10 * 60 * 1000);
      proc.once("close", () => clearTimeout(deadline));
      proc.once("error", () => reject(new Error("TOOL_FAILED")));
      proc.once("exit", (code) => code === 0 ? done() : reject(new Error("TOOL_FAILED")));
    });
  } finally { await output?.close(); }
}
export function validateBackupScope(manifest, fixture = false) {
  const local = manifest.format === 1 && manifest.source === "local-docker-compose";
  const hosted = manifest.format === 2 && manifest.source === "hosted-postgres-r2"
    && /^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest.sourceId ?? "")
    && manifest.database?.schema === "public"
    && manifest.objectStorage?.format === "content-addressed-r2"
    && Number.isInteger(manifest.objectStorage.objectCount) && manifest.objectStorage.objectCount >= 0
    && manifest.objectStorage.objectCount <= 80000
    && /^[a-f0-9]{64}$/.test(manifest.objectStorage.inventorySha256 ?? "");
  if ((!local && !hosted) || (fixture ? manifest.syntheticFixture !== true : manifest.syntheticFixture === true)) fail("INVALID_BACKUP_SCOPE");
}
export async function inspectBackup(directory, fixture = false) {
  if ((await lstat(directory)).isSymbolicLink() || !(await stat(directory)).isDirectory()) fail("INVALID_BACKUP_DIRECTORY");
  try { await lstat(resolve(directory, "INCOMPLETE.txt")); fail("INCOMPLETE_BACKUP"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const manifest = await jsonFile(resolve(directory, "manifest.json"), 32768);
  validateBackupScope(manifest, fixture);
  for (const [field, file] of [["database", FILES[0]], ["objectStorage", FILES[1]]]) {
    if (manifest[field]?.file !== file || !/^[a-f0-9]{64}$/.test(manifest[field]?.sha256 ?? "")) fail("INVALID_MANIFEST");
    const digest = await hashFile(resolve(directory, file), ARCHIVE_LIMIT);
    if (digest.sha256 !== manifest[field].sha256) fail("ARCHIVE_HASH_MISMATCH");
  }
  if (timestamp(manifest.createdAtUtc) > timestamp(manifest.completedAtUtc) || timestamp(manifest.completedAtUtc) > Date.now()) fail("INVALID_BACKUP_TIME");
  // Fresh checks, not trusting a recorded archive-format success flag.
  await command("pg_restore", ["--list", resolve(directory, FILES[0])]);
  await command("tar", ["-tzf", resolve(directory, FILES[1])]);
  return manifest;
}
export async function* parts(path) {
  const file = await open(path, "r");
  try {
    let total = 0;
    for (;;) {
      const part = Buffer.allocUnsafe(PART_BYTES);
      let length = 0;
      while (length < PART_BYTES) {
        const { bytesRead } = await file.read(part, length, PART_BYTES - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (!length) break;
      total += length;
      if (total > CIPHER_LIMIT) fail("FILE_TOO_LARGE");
      yield part.subarray(0, length);
    }
  } finally { await file.close(); }
}
async function remoteHash(store, bucket, key, limit = CIPHER_LIMIT) {
  const response = await store.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) fail("EMPTY_REMOTE_BODY");
  const hash = createHash("sha256"); let bytes = 0;
  try {
    for await (const chunk of response.Body) {
      bytes += chunk.length;
      if (bytes > limit) fail("REMOTE_TOO_LARGE");
      hash.update(chunk);
    }
  } finally { response.Body.destroy?.(); }
  return { bytes, sha256: hash.digest("hex") };
}
export async function assertAbsent(store, bucket, key) {
  try { await remoteHash(store, bucket, key); }
  catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return;
    throw error;
  }
  fail("OBJECT_CONFLICT");
}
export async function uploadMultipart(store, bucket, key, path) {
  await assertAbsent(store, bucket, key);
  let uploadId;
  try {
    const started = await store.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: "application/octet-stream" }));
    uploadId = started.UploadId;
    if (!uploadId) fail("INVALID_MULTIPART_RESPONSE");
    const completed = []; let number = 1;
    for await (const Body of parts(path)) {
      const response = await store.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: number, Body }));
      if (!response.ETag) fail("INVALID_PART_RESPONSE");
      completed.push({ PartNumber: number++, ETag: response.ETag });
    }
    if (!completed.length) fail("EMPTY_UPLOAD");
    await store.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId,
      IfNoneMatch: "*", MultipartUpload: { Parts: completed } }));
    uploadId = undefined;
  } finally {
    if (uploadId) await store.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  }
}
export async function newDirectory(path) {
  if (!isAbsolute(path)) fail("ABSOLUTE_DIRECTORY_REQUIRED");
  const workspace = fileURLToPath(new URL("../", import.meta.url));
  const inWorkspace = relative(workspace, resolve(path));
  if (!inWorkspace || (!inWorkspace.startsWith("..") && !isAbsolute(inWorkspace))) fail("OUTPUT_INSIDE_REPOSITORY");
  const parent = dirname(path);
  if (await realpath(parent) !== resolve(parent)) fail("LINKED_PARENT_DIRECTORY");
  await mkdir(path, { mode: 0o700 }); // No recursive/exist-ok: never overwrite.
}
export function validateReceipt(receipt, config) {
  if (!receipt || receipt.format !== 1 || !/^[a-f0-9]{32}$/.test(receipt.runId ?? "") ||
      !["VERIFIED_CIPHERTEXT_ONLY", "PASS_LOCAL_SYNTHETIC"].includes(receipt.status) ||
      !/^[a-f0-9]{64}$/.test(receipt.recipientFingerprint ?? "") ||
      timestamp(receipt.createdAtUtc) > timestamp(receipt.verifiedAtUtc) ||
      !Array.isArray(receipt.objects) || receipt.objects.length !== 3) fail("INVALID_RECEIPT");
  for (let i = 0; i < FILES.length; i++) {
    const item = receipt.objects[i];
    if (item.file !== `${FILES[i]}.age` || item.key !== `${config.prefix}/${receipt.runId}/${item.file}` ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > (i === 2 ? 65536 : CIPHER_LIMIT) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? "")) fail("INVALID_RECEIPT");
  }
  return receipt;
}
// Optional whole-bucket limit: stop before uploading; never remove older backups.
export async function checkStorageCap(store, config, additionalBytes) {
  if (config.maxStoredBytes === undefined) return;
  if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) fail("INVALID_STORAGE_CAP");
  let total = additionalBytes, token;
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await store.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1000, ContinuationToken: token }));
    for (const object of result.Contents ?? []) {
      if (!Number.isSafeInteger(object.Size) || object.Size < 0) fail("STORAGE_CAP_CHECK_FAILED");
      total += object.Size;
    }
    if (total > config.maxStoredBytes) fail("STORAGE_CAP_REACHED");
    if (!result.IsTruncated) return;
    token = result.NextContinuationToken;
    if (typeof token !== "string" || !token || seen.has(token)) fail("STORAGE_CAP_CHECK_FAILED");
    seen.add(token);
  }
  fail("STORAGE_CAP_CHECK_FAILED");
}
export async function uploadExistingBackup({ config, directory, outputDirectory, fixture = false, store }) {
  config = validateConfig(config, fixture);
  const manifest = await inspectBackup(directory, fixture);
  const recipient = await recipients(config.recipientFile);
  await newDirectory(outputDirectory);
  const runId = randomUUID().replaceAll("-", "");
  const remote = store ?? await client(config);
    const objects = [];
  try {
    let projectedBytes = 32768;
    for (const file of FILES) {
      const source = await hashFile(resolve(directory, file), ARCHIVE_LIMIT);
      projectedBytes += source.bytes + Math.ceil(source.bytes / 65536) * 16 + 4096;
    }
    await checkStorageCap(remote, config, projectedBytes);
    for (const file of FILES) {
      const path = resolve(outputDirectory, `${file}.age`);
      const sourceHash = await hashFile(resolve(directory, file), file === "manifest.json" ? 32768 : ARCHIVE_LIMIT);
      await command("age", ["--encrypt", ...recipient.rows.flatMap((r) => ["--recipient", r]), resolve(directory, file)], path);
      const sourceAfter = await hashFile(resolve(directory, file), file === "manifest.json" ? 32768 : ARCHIVE_LIMIT);
      if (sourceAfter.sha256 !== sourceHash.sha256 || sourceAfter.bytes !== sourceHash.bytes) fail("SOURCE_CHANGED");
      const digest = await hashFile(path);
      const key = `${config.prefix}/${runId}/${file}.age`;
      await uploadMultipart(remote, config.bucket, key, path);
      const checked = await remoteHash(remote, config.bucket, key);
      if (checked.sha256 !== digest.sha256 || checked.bytes !== digest.bytes) fail("REMOTE_HASH_MISMATCH");
      objects.push({ file: `${file}.age`, key, ...digest });
    }
    await inspectBackup(directory, fixture);
    const receipt = { format: 1, runId, status: fixture ? "PASS_LOCAL_SYNTHETIC" : "VERIFIED_CIPHERTEXT_ONLY",
      createdAtUtc: manifest.createdAtUtc, verifiedAtUtc: new Date().toISOString(), recipientFingerprint: recipient.fingerprint,
      objects, offHost: "NOT_VERIFIED", achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" };
    const key = `${config.prefix}/${runId}/receipt.json`;
    await assertAbsent(remote, config.bucket, key);
    const body = Buffer.from(JSON.stringify(receipt));
    await remote.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, IfNoneMatch: "*", ContentType: "application/json" }));
    const checked = await remoteHash(remote, config.bucket, key, 32768);
    if (checked.sha256 !== sha(body) || checked.bytes !== body.length) fail("RECEIPT_HASH_MISMATCH");
    const handle = await open(resolve(outputDirectory, "receipt.json"), "wx", 0o600);
    try { await handle.writeFile(body); } finally { await handle.close(); }
    return receipt;
  } finally { if (!store) remote.destroy(); }
}
export async function restoreToNewDirectory({ config, receipt, outputDirectory, identityFile, fixture = false, store }) {
  config = validateConfig(config, fixture);
  validateReceipt(receipt, config);
  if ((receipt.status === "PASS_LOCAL_SYNTHETIC") !== fixture) fail("RECEIPT_SCOPE_MISMATCH");
  await safeFile(identityFile, 32768);
  await newDirectory(outputDirectory);
  const marker = await open(resolve(outputDirectory, "INCOMPLETE.txt"), "wx", 0o600);
  await marker.writeFile("Restore is not verified. Do not use these artifacts."); await marker.close();
  const remote = store ?? await client(config);
  try {
    for (const item of receipt.objects) {
      const cipher = resolve(outputDirectory, item.file);
      const response = await remote.send(new GetObjectCommand({ Bucket: config.bucket, Key: item.key }));
      if (!response.Body) fail("EMPTY_REMOTE_BODY");
      let bytes = 0; const hash = createHash("sha256");
      async function* bounded() {
        for await (const chunk of response.Body) {
          bytes += chunk.length;
          if (bytes > item.bytes) fail("REMOTE_TOO_LARGE");
          hash.update(chunk); yield chunk;
        }
      }
      try { await pipeline(bounded(), createWriteStream(cipher, { flags: "wx", mode: 0o600 })); }
      finally { response.Body.destroy?.(); }
      if (bytes !== item.bytes || hash.digest("hex") !== item.sha256) fail("REMOTE_HASH_MISMATCH");
      await command("age", ["--decrypt", "--identity", identityFile, cipher], resolve(outputDirectory, item.file.slice(0, -4)));
    }
    await unlink(resolve(outputDirectory, "INCOMPLETE.txt"));
    try { await inspectBackup(outputDirectory, fixture); }
    catch (error) { const mark = await open(resolve(outputDirectory, "INCOMPLETE.txt"), "wx", 0o600); await mark.writeFile("Archive validation failed."); await mark.close(); throw error; }
    return { status: fixture ? "PASS_LOCAL_SYNTHETIC" : "PASS_SCOPED_RESTORED_ARCHIVES", offHost: "NOT_VERIFIED",
      achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" };
  } finally { if (!store) remote.destroy(); }
}
export function assessReceipt(receipt, config, now = Date.now()) {
  validateReceipt(receipt, config);
  const captured = Date.parse(receipt.createdAtUtc), verified = Date.parse(receipt.verifiedAtUtc);
  if (!Number.isSafeInteger(now) || now < verified) fail("INVALID_REPORT_TIME");
  const ageSeconds = (now - captured) / 1000;
  return { status: ageSeconds > 3600 ? "STALE_RECEIPT" : "PASS_SCOPED_RECEIPT_AGE", captureWindowAgeSeconds: ageSeconds,
    retentionDue: ageSeconds >= 30 * 86400, deletionAuthorized: false, scheduledTaskEnabled: false,
    achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED", offHost: "NOT_VERIFIED" };
}
export async function cli(argv) {
  const [action, ...args] = argv;
  const allowed = new Set(["--config", "--backup-directory", "--output-directory", "--receipt", "--identity"]);
  const flags = {};
  if (args.length % 2) fail("INVALID_ARGUMENTS");
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || flags[args[i]] || !args[i + 1]) fail("INVALID_ARGUMENTS");
    flags[args[i]] = args[i + 1];
  }
  if (!flags["--config"]) fail("CONFIG_REQUIRED");
  const config = await loadConfig(flags["--config"]);
  if (action === "plan") return plan(config);
  if (action === "preflight") {
    const publicKeys = await recipients(config.recipientFile);
    // Validates checksum/age parsing, without a private identity or remote calls.
    await command("age", ["--encrypt", "--recipients-file", config.recipientFile]);
    const checkedClient = await client(config); checkedClient.destroy();
    return { status: "PASS_OFFLINE_PREFLIGHT", recipientFingerprint: publicKeys.fingerprint,
      networkCalls: 0, keyRecovery: "NOT_VERIFIED", scheduledTaskEnabled: false, deletionAuthorized: false };
  }
  if (action === "report") return assessReceipt(await jsonFile(flags["--receipt"], 32768), config);
  if (action === "upload-existing-backup") {
    if (!flags["--backup-directory"] || !flags["--output-directory"]) fail("INVALID_ARGUMENTS");
    const receipt = await uploadExistingBackup({ config, directory: flags["--backup-directory"], outputDirectory: flags["--output-directory"] });
    return { status: receipt.status, runId: receipt.runId, offHost: receipt.offHost, scheduledTaskEnabled: false, deletionAuthorized: false };
  }
  if (action === "restore-to-new-directory") {
    if (!flags["--receipt"] || !flags["--output-directory"] || !flags["--identity"]) fail("INVALID_ARGUMENTS");
    return restoreToNewDirectory({ config, receipt: await jsonFile(flags["--receipt"], 32768),
      outputDirectory: flags["--output-directory"], identityFile: flags["--identity"] });
  }
  fail("INVALID_ACTION");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).then((result) => {
    console.log(JSON.stringify(result));
    if (result.status === "STALE_RECEIPT") process.exitCode = 1;
  }).catch(() => {
    console.error(JSON.stringify({ status: "FAILED", reason: "Backup adapter operation failed; details redacted",
      scheduledTaskEnabled: false, deletionAuthorized: false, achievedRpo: "NOT_VERIFIED", achievedRto: "NOT_VERIFIED" }));
    process.exitCode = 1;
  });
}
